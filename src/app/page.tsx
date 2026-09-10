'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuthStore } from '@/store/auth.store';

export default function Home() {
  const router = useRouter();
  const { isAuthenticated, authResolved, loadFromStorage } = useAuthStore();
  useEffect(() => { loadFromStorage(); }, [loadFromStorage]);
  useEffect(() => {
    if (!authResolved) return;
    router.replace(isAuthenticated ? '/dashboard' : '/login');
  }, [authResolved, isAuthenticated, router]);
  return <div className="flex min-h-screen items-center justify-center"><div className="animate-pulse text-gray-400">Loading...</div></div>;
}
