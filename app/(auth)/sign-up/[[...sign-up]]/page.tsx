import { SignUp } from '@clerk/nextjs'
import {authAppearance} from '@/lib/auth-appearance'
export default function SignUpPage() {
  return (
    <div className="min-h-screen flex items-center justify-center bg-[#0e1c26] p-4">
      <SignUp appearance={authAppearance} fallbackRedirectUrl="/dashboard/journal" />
    </div>
  )
}
