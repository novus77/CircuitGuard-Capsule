import { getAddress } from 'viem'

export const formatEndpointCoordinate = (chainId: number, container: string): string => {
  if (!Number.isInteger(chainId) || chainId <= 0) {
    throw new Error('Chain ID must be a positive integer')
  }

  return `${chainId}:${getAddress(container)}`
}
