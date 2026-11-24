import { useEffect, useRef, useState } from 'react';
import { supabase } from './supabase.js';

/**
 * Listen for database changes on the given tables and call onChange(table, payload).
 * Row Level Security applies, so a person only hears about rows they may already read.
 * Returns true while the live connection is up. Screens that poll keep doing so as a fallback.
 */
export function useRealtime(key, tables, onChange, enabled = true) {
  const [live, setLive] = useState(false);
  const cb = useRef(onChange);
  cb.current = onChange;
  const list = tables.join(',');

  useEffect(() => {
    if (!enabled || !supabase) return undefined;
    const channel = supabase.channel(`pf-${key}-${Math.random().toString(36).slice(2, 8)}`);
    list.split(',').forEach((table) => {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, (payload) => cb.current(table, payload));
    });
    channel.subscribe((status) => setLive(status === 'SUBSCRIBED'));
    return () => { setLive(false); supabase.removeChannel(channel); };
  }, [key, list, enabled]);

  return live;
}
