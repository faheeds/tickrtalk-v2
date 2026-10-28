import test from 'node:test'
import assert from 'node:assert/strict'
import { allowsLocalResearch } from '../lib/research/local-access.mjs'
test('local research requires opt-in and a matching browser origin despite internal Next host normalization', () => {
  const request = new Request('http://localhost:4173/api/research', {method:'POST', headers:{host:'127.0.0.1:4173', origin:'http://127.0.0.1:4173'}})
  assert.equal(allowsLocalResearch(request, true), true)
  assert.equal(allowsLocalResearch(request, false), false)
})
test('cross-site requests, missing mutation origins, and non-loopback hosts cannot use local research access', () => {
  for (const headers of [{host:'127.0.0.1:4173',origin:'https://evil.example'}, {host:'127.0.0.1:4173'}, {host:'app.example',origin:'https://app.example'}, {host:'127.0.0.1:4173@evil.example',origin:'http://127.0.0.1:4173@evil.example'}]) {
    assert.equal(allowsLocalResearch(new Request('http://localhost:4173/api/research', {method:'POST',headers}),true),false)
  }
})
