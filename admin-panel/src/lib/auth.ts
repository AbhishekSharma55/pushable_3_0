import { SignJWT, jwtVerify } from 'jose'
import { cookies } from 'next/headers'

const SECRET = new TextEncoder().encode(
  process.env.AUTH_SECRET || 'pushable-admin-secret-key-change-in-prod'
)

const ADMIN_EMAIL = 'admin@example.com'
const ADMIN_PASSWORD = 'admin123'
const COOKIE_NAME = 'admin-session'

export async function authenticate(email: string, password: string) {
  if (email !== ADMIN_EMAIL || password !== ADMIN_PASSWORD) {
    return { success: false as const, error: 'Invalid email or password' }
  }

  const token = await new SignJWT({ email, role: 'admin' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime('24h')
    .sign(SECRET)

  const cookieStore = await cookies()
  cookieStore.set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.ADMIN_COOKIE_SECURE === 'true',
    sameSite: 'lax',
    path: '/',
    maxAge: 60 * 60 * 24, // 24 hours
  })

  return { success: true as const }
}

export async function getSession() {
  const cookieStore = await cookies()
  const token = cookieStore.get(COOKIE_NAME)?.value
  if (!token) return null

  try {
    const { payload } = await jwtVerify(token, SECRET)
    return payload as { email: string; role: string }
  } catch {
    return null
  }
}

export async function logout() {
  const cookieStore = await cookies()
  cookieStore.delete(COOKIE_NAME)
}
