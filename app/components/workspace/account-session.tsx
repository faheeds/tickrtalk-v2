'use client'
import {SignOutButton,useAuth,useUser} from '@clerk/nextjs'
import {SignOut,UserSwitch} from '@phosphor-icons/react'

export function AccountSessionActions(){
 const {user,isLoaded}=useUser()
 const {sessionId}=useAuth()
 return <div className="account-session-actions">
  <div className="account-session-identity"><span>Signed in as</span><strong>{isLoaded?user?.primaryEmailAddress?.emailAddress??user?.fullName??'Your account':'Loading account…'}</strong></div>
  <SignOutButton sessionId={sessionId??undefined} redirectUrl="/sign-in"><button disabled={!isLoaded||!sessionId}>Use another account <UserSwitch size={16}/></button></SignOutButton>
  <SignOutButton sessionId={sessionId??undefined} redirectUrl="/"><button disabled={!isLoaded||!sessionId}>Sign out <SignOut size={16}/></button></SignOutButton>
  <p>Signing out does not pause active paper strategies.</p>
 </div>
}
