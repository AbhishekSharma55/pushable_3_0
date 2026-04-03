import { getCreditCostRanges, getCreditCostMultipliers } from '@/app/actions/credit-ranges'
import { CreditRangesClient } from '@/components/credit-ranges/credit-ranges-client'

export const dynamic = 'force-dynamic'

export default async function CreditRangesPage() {
  const [ranges, multipliers] = await Promise.all([
    getCreditCostRanges(),
    getCreditCostMultipliers(),
  ])

  return <CreditRangesClient initialRanges={ranges} initialMultipliers={multipliers} />
}
