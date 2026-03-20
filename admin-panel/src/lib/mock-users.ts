export type UserStatus = 'Active' | 'Blocked' | 'Pending'
export type UserRole = 'Owner' | 'Admin' | 'Member'
export type PlanType = 'Free' | 'Pro' | 'Enterprise'

export interface ActivityEntry {
  action: string
  timestamp: string
}

export interface MockUser {
  id: string
  name: string
  email: string
  initials: string
  avatarColor: string
  workspace: string
  workspaceId: string
  role: UserRole
  plan: PlanType
  joinedDate: string
  lastActive: string
  status: UserStatus
  usagePercent: number
  renewalDate: string
  activityLog: ActivityEntry[]
}

export const MOCK_USERS: MockUser[] = [
  {
    id: 'u1', name: 'Alice Johnson', email: 'alice@techcorp.com',
    initials: 'AJ', avatarColor: '#6366f1',
    workspace: 'TechCorp', workspaceId: 'ws_tc_001',
    role: 'Owner', plan: 'Enterprise', joinedDate: 'Jan 12, 2024', lastActive: '2 min ago',
    status: 'Active', usagePercent: 72, renewalDate: 'Feb 12, 2025',
    activityLog: [
      { action: 'Updated workspace billing settings', timestamp: '2 minutes ago' },
      { action: 'Invited 3 new team members', timestamp: '1 day ago' },
      { action: 'Created project "Q1 Campaign"', timestamp: '3 days ago' },
      { action: 'Upgraded plan to Enterprise', timestamp: '1 week ago' },
      { action: 'Logged in from Chrome / macOS', timestamp: '1 week ago' },
    ],
  },
  {
    id: 'u2', name: 'Bob Smith', email: 'bob@startup.io',
    initials: 'BS', avatarColor: '#0ea5e9',
    workspace: 'StartupIO', workspaceId: 'ws_si_002',
    role: 'Admin', plan: 'Pro', joinedDate: 'Mar 5, 2024', lastActive: '1 hr ago',
    status: 'Active', usagePercent: 45, renewalDate: 'Apr 5, 2025',
    activityLog: [
      { action: 'Reset API key', timestamp: '1 hour ago' },
      { action: 'Added new integration (Slack)', timestamp: '2 days ago' },
      { action: 'Updated team permissions', timestamp: '5 days ago' },
      { action: 'Logged in from Firefox / Windows', timestamp: '1 week ago' },
      { action: 'Created new automation flow', timestamp: '2 weeks ago' },
    ],
  },
  {
    id: 'u3', name: 'Carol Davis', email: 'carol@freelance.dev',
    initials: 'CD', avatarColor: '#10b981',
    workspace: 'Solo Dev', workspaceId: 'ws_sd_003',
    role: 'Owner', plan: 'Free', joinedDate: 'Apr 20, 2024', lastActive: '3 days ago',
    status: 'Active', usagePercent: 88, renewalDate: '—',
    activityLog: [
      { action: 'Reached 90% usage limit', timestamp: '3 days ago' },
      { action: 'Created project "Portfolio"', timestamp: '1 week ago' },
      { action: 'Logged in from Chrome / macOS', timestamp: '1 week ago' },
      { action: 'Updated profile picture', timestamp: '2 weeks ago' },
      { action: 'Account created', timestamp: '1 month ago' },
    ],
  },
  {
    id: 'u4', name: 'David Wilson', email: 'david@bigfirm.com',
    initials: 'DW', avatarColor: '#f59e0b',
    workspace: 'BigFirm Inc', workspaceId: 'ws_bf_004',
    role: 'Member', plan: 'Enterprise', joinedDate: 'Feb 1, 2024', lastActive: '15 days ago',
    status: 'Blocked', usagePercent: 33, renewalDate: 'Mar 1, 2025',
    activityLog: [
      { action: 'Account blocked by admin', timestamp: '15 days ago' },
      { action: 'Multiple failed login attempts', timestamp: '15 days ago' },
      { action: 'Logged in from unknown IP', timestamp: '16 days ago' },
      { action: 'Downloaded user data export', timestamp: '20 days ago' },
      { action: 'Changed email address', timestamp: '1 month ago' },
    ],
  },
  {
    id: 'u5', name: 'Emma Brown', email: 'emma@agency.co',
    initials: 'EB', avatarColor: '#ec4899',
    workspace: 'Creative Agency', workspaceId: 'ws_ca_005',
    role: 'Admin', plan: 'Pro', joinedDate: 'May 15, 2024', lastActive: '5 hr ago',
    status: 'Active', usagePercent: 56, renewalDate: 'Jun 15, 2025',
    activityLog: [
      { action: 'Published 2 automation workflows', timestamp: '5 hours ago' },
      { action: 'Invited team member: Jake R.', timestamp: '2 days ago' },
      { action: 'Updated notification settings', timestamp: '4 days ago' },
      { action: 'Created project "Brand Refresh"', timestamp: '1 week ago' },
      { action: 'Logged in from Safari / iOS', timestamp: '1 week ago' },
    ],
  },
  {
    id: 'u6', name: 'Frank Miller', email: 'frank@indie.io',
    initials: 'FM', avatarColor: '#8b5cf6',
    workspace: 'Indie Labs', workspaceId: 'ws_il_006',
    role: 'Owner', plan: 'Free', joinedDate: 'Jun 3, 2024', lastActive: 'Never',
    status: 'Pending', usagePercent: 0, renewalDate: '—',
    activityLog: [
      { action: 'Verification email sent', timestamp: '5 days ago' },
      { action: 'Account registered', timestamp: '5 days ago' },
    ],
  },
  {
    id: 'u7', name: 'Grace Lee', email: 'grace@techco.com',
    initials: 'GL', avatarColor: '#06b6d4',
    workspace: 'TechCo', workspaceId: 'ws_tco_007',
    role: 'Member', plan: 'Pro', joinedDate: 'Mar 22, 2024', lastActive: '1 day ago',
    status: 'Active', usagePercent: 61, renewalDate: 'Apr 22, 2025',
    activityLog: [
      { action: 'Submitted support ticket #4821', timestamp: '1 day ago' },
      { action: 'Logged in from Chrome / Linux', timestamp: '1 day ago' },
      { action: 'Viewed billing history', timestamp: '3 days ago' },
      { action: 'Updated password', timestamp: '2 weeks ago' },
      { action: 'Enabled 2FA', timestamp: '1 month ago' },
    ],
  },
  {
    id: 'u8', name: 'Henry Taylor', email: 'henry@enterprise.com',
    initials: 'HT', avatarColor: '#f43f5e',
    workspace: 'Enterprise Corp', workspaceId: 'ws_ec_008',
    role: 'Admin', plan: 'Enterprise', joinedDate: 'Jan 8, 2024', lastActive: '30 min ago',
    status: 'Active', usagePercent: 41, renewalDate: 'Jan 8, 2025',
    activityLog: [
      { action: 'Reviewed 5 pending invitations', timestamp: '30 minutes ago' },
      { action: 'Updated SSO configuration', timestamp: '2 days ago' },
      { action: 'Generated audit log export', timestamp: '1 week ago' },
      { action: 'Added new domain to allowlist', timestamp: '2 weeks ago' },
      { action: 'Logged in from Edge / Windows', timestamp: '2 weeks ago' },
    ],
  },
  {
    id: 'u9', name: 'Isabella Martinez', email: 'isabella@startup.co',
    initials: 'IM', avatarColor: '#84cc16',
    workspace: 'Startup Co', workspaceId: 'ws_sc_009',
    role: 'Owner', plan: 'Pro', joinedDate: 'Apr 11, 2024', lastActive: '7 days ago',
    status: 'Blocked', usagePercent: 79, renewalDate: 'May 11, 2025',
    activityLog: [
      { action: 'Account blocked — payment failed', timestamp: '7 days ago' },
      { action: 'Payment declined (Visa ending 4242)', timestamp: '7 days ago' },
      { action: 'Renewal reminder sent', timestamp: '10 days ago' },
      { action: 'Logged in from Chrome / macOS', timestamp: '2 weeks ago' },
      { action: 'Created project "Launch Plan"', timestamp: '3 weeks ago' },
    ],
  },
  {
    id: 'u10', name: 'James Anderson', email: 'james@media.io',
    initials: 'JA', avatarColor: '#f97316',
    workspace: 'Media Works', workspaceId: 'ws_mw_010',
    role: 'Member', plan: 'Free', joinedDate: 'May 30, 2024', lastActive: '2 days ago',
    status: 'Active', usagePercent: 22, renewalDate: '—',
    activityLog: [
      { action: 'Logged in from Chrome / Windows', timestamp: '2 days ago' },
      { action: 'Updated profile information', timestamp: '1 week ago' },
      { action: 'Joined workspace "Media Works"', timestamp: '1 month ago' },
      { action: 'Account created', timestamp: '1 month ago' },
      { action: 'Confirmed email address', timestamp: '1 month ago' },
    ],
  },
  {
    id: 'u11', name: 'Kate Thompson', email: 'kate@design.co',
    initials: 'KT', avatarColor: '#a855f7',
    workspace: 'Design Studio', workspaceId: 'ws_ds_011',
    role: 'Admin', plan: 'Pro', joinedDate: 'Feb 14, 2024', lastActive: '4 hr ago',
    status: 'Active', usagePercent: 67, renewalDate: 'Mar 14, 2025',
    activityLog: [
      { action: 'Exported design assets', timestamp: '4 hours ago' },
      { action: 'Created shared workspace template', timestamp: '2 days ago' },
      { action: 'Reviewed billing cycle', timestamp: '1 week ago' },
      { action: 'Upgraded from Free to Pro', timestamp: '2 months ago' },
      { action: 'Logged in from Chrome / macOS', timestamp: '2 months ago' },
    ],
  },
  {
    id: 'u12', name: 'Liam Garcia', email: 'liam@cloud.io',
    initials: 'LG', avatarColor: '#14b8a6',
    workspace: 'Cloud Systems', workspaceId: 'ws_cs_012',
    role: 'Member', plan: 'Enterprise', joinedDate: 'Jan 20, 2024', lastActive: '6 hr ago',
    status: 'Active', usagePercent: 53, renewalDate: 'Jan 20, 2025',
    activityLog: [
      { action: 'Accessed API key management', timestamp: '6 hours ago' },
      { action: 'Created webhook endpoint', timestamp: '3 days ago' },
      { action: 'Ran bulk data export job', timestamp: '1 week ago' },
      { action: 'Logged in from Chrome / Ubuntu', timestamp: '1 week ago' },
      { action: 'Joined workspace "Cloud Systems"', timestamp: '2 months ago' },
    ],
  },
  {
    id: 'u13', name: 'Mia Rodriguez', email: 'mia@analytics.co',
    initials: 'MR', avatarColor: '#e11d48',
    workspace: 'Analytics Pro', workspaceId: 'ws_ap_013',
    role: 'Owner', plan: 'Pro', joinedDate: 'Mar 1, 2024', lastActive: '10 min ago',
    status: 'Active', usagePercent: 91, renewalDate: 'Apr 1, 2025',
    activityLog: [
      { action: 'Usage limit warning triggered', timestamp: '10 minutes ago' },
      { action: 'Ran large analytics query', timestamp: '10 minutes ago' },
      { action: 'Scheduled weekly report', timestamp: '3 days ago' },
      { action: 'Added integration: Google Analytics', timestamp: '1 week ago' },
      { action: 'Upgraded plan to Pro', timestamp: '1 month ago' },
    ],
  },
  {
    id: 'u14', name: 'Noah White', email: 'noah@dev.io',
    initials: 'NW', avatarColor: '#64748b',
    workspace: 'Dev Shop', workspaceId: 'ws_dv_014',
    role: 'Member', plan: 'Free', joinedDate: 'Jun 18, 2024', lastActive: '20 days ago',
    status: 'Blocked', usagePercent: 0, renewalDate: '—',
    activityLog: [
      { action: 'Account blocked — TOS violation', timestamp: '20 days ago' },
      { action: 'Warning issued by admin', timestamp: '22 days ago' },
      { action: 'Reported for spam activity', timestamp: '25 days ago' },
      { action: 'Logged in from unknown device', timestamp: '1 month ago' },
      { action: 'Account created', timestamp: '1 month ago' },
    ],
  },
  {
    id: 'u15', name: 'Olivia Harris', email: 'olivia@corp.com',
    initials: 'OH', avatarColor: '#d97706',
    workspace: 'Corp Solutions', workspaceId: 'ws_cor_015',
    role: 'Admin', plan: 'Enterprise', joinedDate: 'Feb 28, 2024', lastActive: '1 day ago',
    status: 'Active', usagePercent: 38, renewalDate: 'Mar 28, 2025',
    activityLog: [
      { action: 'Provisioned 10 new user seats', timestamp: '1 day ago' },
      { action: 'Updated SAML configuration', timestamp: '3 days ago' },
      { action: 'Reviewed security audit log', timestamp: '1 week ago' },
      { action: 'Logged in from Edge / Windows', timestamp: '1 week ago' },
      { action: 'Generated compliance report', timestamp: '2 weeks ago' },
    ],
  },
  {
    id: 'u16', name: 'Peter Clark', email: 'peter@saas.io',
    initials: 'PC', avatarColor: '#7c3aed',
    workspace: 'SaaS Platform', workspaceId: 'ws_sp_016',
    role: 'Member', plan: 'Pro', joinedDate: 'Jun 1, 2024', lastActive: 'Never',
    status: 'Pending', usagePercent: 0, renewalDate: 'Jul 1, 2025',
    activityLog: [
      { action: 'Verification email sent (2nd attempt)', timestamp: '2 days ago' },
      { action: 'Verification email sent', timestamp: '5 days ago' },
      { action: 'Pro plan subscription created', timestamp: '5 days ago' },
      { action: 'Account registered', timestamp: '5 days ago' },
    ],
  },
  {
    id: 'u17', name: 'Quinn Lewis', email: 'quinn@ai.co',
    initials: 'QL', avatarColor: '#0f766e',
    workspace: 'AI Labs', workspaceId: 'ws_ai_017',
    role: 'Owner', plan: 'Enterprise', joinedDate: 'Jan 3, 2024', lastActive: '45 min ago',
    status: 'Active', usagePercent: 84, renewalDate: 'Jan 3, 2025',
    activityLog: [
      { action: 'Deployed new model endpoint', timestamp: '45 minutes ago' },
      { action: 'Reviewed API usage dashboard', timestamp: '3 hours ago' },
      { action: 'Added custom domain', timestamp: '2 days ago' },
      { action: 'Expanded Enterprise seat limit', timestamp: '1 week ago' },
      { action: 'Logged in from Chrome / macOS', timestamp: '1 week ago' },
    ],
  },
  {
    id: 'u18', name: 'Rachel Walker', email: 'rachel@marketing.co',
    initials: 'RW', avatarColor: '#be185d',
    workspace: 'Marketing Hub', workspaceId: 'ws_mh_018',
    role: 'Member', plan: 'Free', joinedDate: 'May 10, 2024', lastActive: '3 days ago',
    status: 'Active', usagePercent: 14, renewalDate: '—',
    activityLog: [
      { action: 'Created campaign template', timestamp: '3 days ago' },
      { action: 'Logged in from Safari / macOS', timestamp: '3 days ago' },
      { action: 'Updated notification preferences', timestamp: '2 weeks ago' },
      { action: 'Joined workspace "Marketing Hub"', timestamp: '1 month ago' },
      { action: 'Account created', timestamp: '1 month ago' },
    ],
  },
  {
    id: 'u19', name: 'Sam Hall', email: 'sam@fintech.io',
    initials: 'SH', avatarColor: '#1d4ed8',
    workspace: 'FinTech Pro', workspaceId: 'ws_ft_019',
    role: 'Admin', plan: 'Enterprise', joinedDate: 'Feb 7, 2024', lastActive: '12 days ago',
    status: 'Blocked', usagePercent: 55, renewalDate: 'Mar 7, 2025',
    activityLog: [
      { action: 'Account suspended — compliance review', timestamp: '12 days ago' },
      { action: 'Compliance review initiated', timestamp: '12 days ago' },
      { action: 'Unusual data export detected', timestamp: '13 days ago' },
      { action: 'Logged in from new IP location', timestamp: '14 days ago' },
      { action: 'Modified API rate limit settings', timestamp: '3 weeks ago' },
    ],
  },
  {
    id: 'u20', name: 'Tina Young', email: 'tina@health.co',
    initials: 'TY', avatarColor: '#059669',
    workspace: 'Health Tech', workspaceId: 'ws_ht_020',
    role: 'Member', plan: 'Pro', joinedDate: 'Apr 2, 2024', lastActive: '8 hr ago',
    status: 'Active', usagePercent: 29, renewalDate: 'May 2, 2025',
    activityLog: [
      { action: 'Logged in from Chrome / Windows', timestamp: '8 hours ago' },
      { action: 'Updated HIPAA compliance settings', timestamp: '2 days ago' },
      { action: 'Invited collaborator: Dr. M. Patel', timestamp: '1 week ago' },
      { action: 'Created encrypted data workspace', timestamp: '2 weeks ago' },
      { action: 'Upgraded from Free to Pro', timestamp: '2 months ago' },
    ],
  },
]
