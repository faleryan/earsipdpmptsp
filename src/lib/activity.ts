import { supabase } from './supabase'

/** Catat peristiwa non-DML (pratinjau, unduh, ekspor). Kegagalan pencatatan tidak menghentikan proses. */
export async function logActivity(
  action: string,
  entityType: string | null,
  entityId: string | null,
  description: string,
  metadata: Record<string, unknown> = {},
) {
  const { error } = await supabase.rpc('log_activity', {
    p_action: action,
    p_entity_type: entityType,
    p_entity_id: entityId,
    p_description: description,
    p_metadata: metadata,
  })
  if (error) console.warn('Gagal mencatat aktivitas', error)
}
