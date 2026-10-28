"""Run the pinned Vibe-Trading backtest against broker-key-free local bars."""
from __future__ import annotations

import csv
import gzip
import json
import os
import subprocess
import sys
import traceback
from pathlib import Path

ROOT = Path('/vercel/sandbox')
JOB = ROOT / 'job'
# Vibe-Trading validates run directories against a fixed allowlist. Keep every
# run artifact beneath its explicitly allowed per-job root.
RUN = JOB / 'run' / 'runs' / 'tickrtalk'
DATA = JOB / 'data'
DATA_CONFIG = Path.home() / '.vibe-trading' / 'data-bridge' / 'config.yaml'
VERSION = '0.1.18'


def stage(name: str) -> None:
    (JOB / 'progress.json').write_text(json.dumps({'stage': name}), encoding='utf-8')


def write_market_files(request: dict) -> None:
    DATA.mkdir(parents=True, exist_ok=True)
    sources = []
    rows_by_symbol: dict[str, list[dict]] = {f'{symbol}.US': [] for symbol in request['symbols']}
    with gzip.open(JOB / 'bars.csv.gz', 'rt', newline='', encoding='utf-8') as data_file:
        for row in csv.DictReader(data_file):
            symbol = row.get('symbol')
            if symbol not in rows_by_symbol:
                continue
            rows_by_symbol[symbol].append(row)
    present = []
    for symbol, rows in rows_by_symbol.items():
        if len(rows) < request['slowWindow'] + 5:
            continue
        path = DATA / f'{symbol}.csv'
        with path.open('w', newline='', encoding='utf-8') as output:
            writer = csv.DictWriter(output, fieldnames=['date', 'open', 'high', 'low', 'close', 'volume'])
            writer.writeheader()
            for row in rows:
                writer.writerow({key: row[key] for key in writer.fieldnames})
        sources.append({'symbol': symbol, 'type': 'csv', 'path': str(path)})
        present.append(symbol)
    excluded = sorted(set(rows_by_symbol) - set(present))
    if not present:
        raise ValueError('There is not enough complete price history for this strategy and date range.')
    DATA_CONFIG.parent.mkdir(parents=True, exist_ok=True)
    # JSON is valid YAML, so the system Python that launches this worker does
    # not need to import PyYAML from the isolated backtest virtual environment.
    DATA_CONFIG.write_text(json.dumps({'sources': sources}, indent=2), encoding='utf-8')
    request['symbols'] = [symbol.removesuffix('.US') for symbol in present]
    request['excludedSymbols'] = [symbol.removesuffix('.US') for symbol in excluded]


def write_strategy(request: dict) -> None:
    RUN.mkdir(parents=True, exist_ok=True)
    code_dir = RUN / 'code'
    code_dir.mkdir(parents=True, exist_ok=True)
    fast = request['fastWindow']
    slow = request['slowWindow']
    lines = [
        'from __future__ import annotations',
        'import pandas as pd',
        '',
        'class SignalEngine:',
        '    def generate(self, data_map):',
        '        active = {}',
        '        for symbol, frame in data_map.items():',
        '            close = frame["close"]',
    ]
    if request['strategy'] == 'moving_average_trend':
        lines.extend([
            f'            fast = close.rolling({fast}, min_periods={fast}).mean()',
            f'            slow = close.rolling({slow}, min_periods={slow}).mean()',
            '            active[symbol] = (fast > slow).fillna(False).astype(float)',
        ])
    elif request['strategy'] == 'momentum_confirmation':
        lines.extend([
            f'            short_return = close.pct_change({fast})',
            f'            long_return = close.pct_change({slow})',
            '            active[symbol] = ((short_return > 0) & (long_return > 0)).fillna(False).astype(float)',
        ])
    elif request['strategy'] == 'bollinger_pullback':
        lines.extend([
            f'            center = close.rolling({fast}, min_periods={fast}).mean()',
            f'            deviation = close.rolling({fast}, min_periods={fast}).std()',
            f'            trend = close.rolling({slow}, min_periods={slow}).mean()',
            '            holding = 0.0',
            '            signal = []',
            '            for price, mid, spread, trend_mid in zip(close, center, deviation, trend):',
            '                if pd.isna(mid) or pd.isna(spread) or pd.isna(trend_mid):',
            '                    holding = 0.0',
            '                elif holding and price >= mid:',
            '                    holding = 0.0',
            '                elif not holding and price < mid - 2.0 * spread and price > trend_mid:',
            '                    holding = 1.0',
            '                signal.append(holding)',
            '            active[symbol] = pd.Series(signal, index=frame.index, dtype=float)',
        ])
    else:
        lines.extend([
            f'            entry = frame["high"].shift(1).rolling({slow}, min_periods={slow}).max()',
            f'            exit = frame["low"].shift(1).rolling({fast}, min_periods={fast}).min()',
            '            holding = 0.0',
            '            signal = []',
            '            for price, entry_level, exit_level in zip(close, entry, exit):',
            '                if pd.isna(entry_level) or pd.isna(exit_level):',
            '                    holding = 0.0',
            '                elif holding and price < exit_level:',
            '                    holding = 0.0',
            '                elif not holding and price > entry_level:',
            '                    holding = 1.0',
            '                signal.append(holding)',
            '            active[symbol] = pd.Series(signal, index=frame.index, dtype=float)',
        ])
    lines.extend([
        '        if not active:',
        '            return {}',
        '        signal_frame = pd.DataFrame(active).fillna(0.0)',
        '        active_count = signal_frame.sum(axis=1).replace(0.0, float("nan"))',
        '        weights = signal_frame.div(active_count, axis=0).fillna(0.0)',
        '        return {symbol: weights[symbol] for symbol in weights.columns}',
        '',
    ])
    strategy_code = '\n'.join(lines)
    (code_dir / 'signal_engine.py').write_text(strategy_code, encoding='utf-8')
    load_start = request['loadStartDate']
    config = {
        'source': 'local',
        'codes': [f'local:{symbol}.US' for symbol in request['symbols']],
        'start_date': load_start,
        'end_date': request['endDate'],
        'evaluation_start_date': request['startDate'],
        'interval': '1D',
        'initial_cash': request['initialCapital'],
        'commission': 0.0,
        'slippage_us': 0.0005,
        'leverage': 1.0,
        'engine': 'daily',
        'position_adjustment': 'rebalance',
        'validation': {
            'monte_carlo': {'n_simulations': 1000, 'seed': 42},
            'bootstrap': {'n_bootstrap': 1000, 'confidence': 0.95, 'seed': 42},
            'walk_forward': {'n_windows': 5},
        },
    }
    (RUN / 'config.json').write_text(json.dumps(config), encoding='utf-8')


def rows(path: Path, limit: int | None = None) -> list[dict]:
    if not path.exists():
        return []
    with path.open(newline='', encoding='utf-8') as file:
        values = list(csv.DictReader(file))
    return values[-limit:] if limit else values


def trade_rows(path: Path, limit: int = 250) -> list[dict]:
    values = rows(path, limit)
    return [{
        'date': row.get('date') or row.get('timestamp'),
        'symbol': row.get('symbol') or row.get('code'),
        'side': row.get('side'),
        'quantity': row.get('quantity') or row.get('qty'),
        'price': row.get('price'),
        'pnl': row.get('pnl'),
    } for row in values]


def compact_equity(path: Path) -> list[dict]:
    values = rows(path)
    if len(values) <= 400:
        return values
    indexes = sorted({round(index * (len(values) - 1) / 399) for index in range(400)})
    return [values[index] for index in indexes]


def build_result(request: dict) -> dict:
    artifacts = RUN / 'artifacts'
    card_path = RUN / 'run_card.json'
    card = json.loads(card_path.read_text(encoding='utf-8')) if card_path.exists() else {}
    return {
        'engine': 'Vibe-Trading GlobalEquityEngine',
        'version': VERSION,
        'repository': 'https://github.com/HKUDS/Vibe-Trading',
        'dataProvider': 'Alpaca',
        'feed': request['feed'],
        'adjustment': 'all',
        'request': {key: request[key] for key in ('strategyName', 'fastWindow', 'slowWindow', 'initialCapital', 'startDate', 'endDate', 'feed', 'universe')},
        'coverage': {
            'requested': request['requestedSymbols'],
            'included': request['symbols'],
            'excluded': request.get('excludedSymbols', []),
        },
        'metrics': card.get('metrics', card),
        'validation': card.get('validation', {}),
        'warnings': list(card.get('warnings', [])) + [
            'Broker commissions and exchange fees are not modeled.',
            'Fractional share sizing may differ from live cash orders.',
        ] + (['The S&P 500 uses the current constituent snapshot, which can introduce survivorship bias.'] if request['universe'] == 'sp500' else []),
        'equity': compact_equity(artifacts / 'equity.csv'),
        'trades': trade_rows(artifacts / 'trades.csv'),
    }


def main() -> None:
    try:
        marker = JOB / 'started'
        fd = os.open(marker, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
        os.close(fd)
        request = json.loads((JOB / 'request.json').read_text(encoding='utf-8'))
        stage('Installing the isolated backtest engine')
        venv = ROOT / '.vibe-venv'
        venv_python = venv / 'bin' / 'python'
        with (JOB / 'worker.log').open('w', encoding='utf-8') as install_log:
            subprocess.run(['uv', 'venv', '--managed-python', '--python', '3.13', str(venv)], check=True,
                           stdout=install_log, stderr=subprocess.STDOUT, timeout=300)
            subprocess.run(['uv', 'pip', 'install', '--python', str(venv_python), '-r', str(ROOT / 'requirements.txt')],
                           check=True, stdout=install_log, stderr=subprocess.STDOUT, timeout=600)
        stage('Preparing the market history')
        installed_version = subprocess.check_output(
            [str(venv_python), '-c', "import importlib.metadata; print(importlib.metadata.version('vibe-trading-ai'))"],
            text=True, timeout=30,
        ).strip()
        if installed_version != VERSION:
            raise ValueError('The installed Vibe-Trading version does not match this run.')
        write_market_files(request)
        write_strategy(request)
        stage('Running the backtest and robustness checks')
        log_path = JOB / 'runner.log'
        with log_path.open('w', encoding='utf-8') as log:
            subprocess.run(
                [str(venv_python), '-m', 'backtest.runner', str(RUN)],
                check=True,
                cwd=JOB / 'run',
                stdout=log,
                stderr=subprocess.STDOUT,
                timeout=1200,
                env={'PATH': os.environ.get('PATH', ''), 'HOME': str(Path.home()), 'PYTHONPATH': str(Path(__file__).parent)},
            )
        result = build_result(request)
        result['coverage']['excluded'] = request.get('excludedSymbols', [])
        (JOB / 'final.json').write_text(json.dumps(result, allow_nan=False), encoding='utf-8')
        (JOB / 'done.json').write_text(json.dumps({'success': True}), encoding='utf-8')
    except Exception as error:
        try:
            (JOB / 'worker.log').write_text(f'{type(error).__name__}: {error}\n{traceback.format_exc()[-3000:]}', encoding='utf-8')
            details = f'{type(error).__name__}: {error}'
            for log_name in ('runner.log', 'worker.log'):
                log_path = JOB / log_name
                if log_path.exists():
                    log_lines = [line.strip() for line in log_path.read_text(encoding='utf-8', errors='replace').splitlines() if line.strip()]
                    if log_lines:
                        details += '\n' + '\n'.join(log_lines[-6:])
                    break
            (JOB / 'done.json').write_text(json.dumps({'success': False, 'error': details[-1800:]}), encoding='utf-8')
        except Exception:
            pass


if __name__ == '__main__':
    main()
