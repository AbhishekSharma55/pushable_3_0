'use server'

import { authenticate, logout } from '@/lib/auth'
import { redirect } from 'next/navigation'

export async function loginAction(_prev: unknown, formData: FormData) {
  const email = formData.get('email') as string
  const password = formData.get('password') as string

  if (!email || !password) {
    return { error: 'Email and password are required' }
  }

  const result = await authenticate(email, password)
  if (!result.success) {
    return { error: result.error }
  }

  redirect('/users')
}

export async function logoutAction() {
  await logout()
  redirect('/login')
}
