export function isAuthorizedDriverStatus(status: string | null | undefined): boolean {
  return status === 'verified';
}
