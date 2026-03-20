import { getUsers } from '@/app/actions/users'
import { UserManagementClient } from '@/components/users/user-management-client'

export default async function UsersPage() {
  const users = await getUsers()

  return <UserManagementClient initialUsers={users} />
}
