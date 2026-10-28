import { SignIn } from '@clerk/nextjs'
import {authAppearance} from '@/lib/auth-appearance'
export default function SignInPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0e1c26] p-4">
      <div className="text-center">
        <SignIn appearance={authAppearance} fallbackRedirectUrl="/dashboard/journal" />
      </div>
    </div>
  )
}
