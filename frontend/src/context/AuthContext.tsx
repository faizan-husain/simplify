import React, { createContext, useContext, useEffect, useState } from 'react';
import { User, Session } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';
import { Database } from '../types/supabase';

type Member = Database['public']['Tables']['members']['Row'];
type Business = Database['public']['Tables']['businesses']['Row'];

interface AuthContextType {
  user: User | null;
  session: Session | null;
  member: Member | null;
  business: Business | null;
  role: 'OWNER' | 'ACCOUNTANT' | 'STAFF' | null;
  loading: boolean;
  refreshProfile: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [member, setMember] = useState<Member | null>(null);
  const [business, setBusiness] = useState<Business | null>(null);
  const [loading, setLoading] = useState(true);

  const fetchProfile = async (currentUser: User) => {
    try {
      const { data: memberData } = await supabase
        .from('members')
        .select('*')
        .eq('auth_user_id', currentUser.id)
        .eq('active', true)
        .is('deleted_at', null)
        .maybeSingle();

      if (memberData) {
        setMember(memberData as Member);

        const { data: bizData } = await supabase
          .from('businesses')
          .select('*')
          .eq('id', memberData.business_id)
          .is('deleted_at', null)
          .maybeSingle();

        if (bizData) {
          setBusiness(bizData as Business);
        }
      } else {
        setMember(null);
        setBusiness(null);
      }
    } catch (err) {
      console.error('Error fetching profile:', err);
    }
  };

  const refreshProfile = async () => {
    if (user) {
      await fetchProfile(user);
    }
  };

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        fetchProfile(session.user).finally(() => setLoading(false));
      } else {
        setLoading(false);
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange(async (_event, session) => {
      setSession(session);
      setUser(session?.user ?? null);
      if (session?.user) {
        await fetchProfile(session.user);
      } else {
        setMember(null);
        setBusiness(null);
      }
      setLoading(false);
    });

    return () => subscription.unsubscribe();
  }, []);

  const signOut = async () => {
    await supabase.auth.signOut();
    setUser(null);
    setSession(null);
    setMember(null);
    setBusiness(null);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        session,
        member,
        business,
        role: member?.role ?? null,
        loading,
        refreshProfile,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
