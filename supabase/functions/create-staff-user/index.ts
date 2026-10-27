// Supabase Edge Function: create-staff-user
import { serve } from 'https://deno.land/std@0.177.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.48.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '';
    const loginDomain = Deno.env.get('VITE_LOGIN_EMAIL_DOMAIN') ?? 'simplify.local';

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // 1. Verify caller session and role
    const userClient = createClient(supabaseUrl, supabaseServiceKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check caller is Owner
    const { data: callerMember, error: memberError } = await userClient
      .from('members')
      .select('business_id, role')
      .eq('auth_user_id', user.id)
      .eq('active', true)
      .single();

    if (memberError || !callerMember || callerMember.role !== 'OWNER') {
      return new Response(JSON.stringify({ error: 'UNAUTHORIZED: Owner access required' }), {
        status: 403,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { name, mobile, role, can_login, password } = await req.json();

    if (!name || !mobile || !role) {
      return new Response(JSON.stringify({ error: 'Name, mobile and role are required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const cleanMobile = mobile.replace(/\D/g, '').slice(-10);
    const adminClient = createClient(supabaseUrl, supabaseServiceKey);
    let authUserId: string | null = null;

    if (can_login) {
      if (!password || password.length < 8) {
        return new Response(JSON.stringify({ error: 'Password must be at least 8 characters' }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }

      const email = `91${cleanMobile}@${loginDomain}`;
      const { data: newUser, error: createAuthError } = await adminClient.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: { name, mobile: cleanMobile },
      });

      if (createAuthError) {
        return new Response(JSON.stringify({ error: createAuthError.message }), {
          status: 400,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      authUserId = newUser.user.id;
    }

    // Insert member row
    const { data: newMember, error: insertError } = await adminClient
      .from('members')
      .insert({
        business_id: callerMember.business_id,
        auth_user_id: authUserId,
        name,
        mobile: cleanMobile,
        role,
        can_login: !!can_login,
        active: true,
      })
      .select()
      .single();

    if (insertError) {
      // Rollback auth user if member insert fails
      if (authUserId) {
        await adminClient.auth.admin.deleteUser(authUserId);
      }
      return new Response(JSON.stringify({ error: insertError.message }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    return new Response(JSON.stringify(newMember), {
      status: 201,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  } catch (err: any) {
    return new Response(JSON.stringify({ error: err.message || 'Internal Server Error' }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
