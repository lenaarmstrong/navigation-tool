export function getDriveBackupStatus(): { configured: boolean; folderId: string; serviceAccountEmailSet: boolean; privateKeySet: boolean } {
  return {
    configured: false,
    folderId: '',
    serviceAccountEmailSet: false,
    privateKeySet: false
  };
}

export async function processDriveBackupQueue(): Promise<void> {
  // Supabase storage is the primary persistent store.
}
