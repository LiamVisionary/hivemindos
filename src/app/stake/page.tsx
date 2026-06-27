import StakePageClient from "./StakePageClient";
import { DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS, isHiveEvmAddress } from "@/lib/config/hive-staking";

export default function StakePage() {
  const stakingAddress = process.env.NEXT_PUBLIC_HIVE_STAKING_CONTRACT_ADDRESS?.trim()
    || DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS;

  const resolvedStakingAddress = isHiveEvmAddress(stakingAddress)
    ? stakingAddress
    : DEFAULT_BASE_HIVE_STAKING_CONTRACT_ADDRESS;

  return <StakePageClient stakingContractAddress={resolvedStakingAddress} />;
}
