-- Migration: 20261105000034_demo_requests.sql
-- Description: Create demo_requests table and secure public submission RPC

CREATE TABLE IF NOT EXISTS public.demo_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    full_name TEXT NOT NULL,
    business_name TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT NOT NULL,
    business_type TEXT NOT NULL,
    preferred_date DATE,
    message TEXT,
    status TEXT NOT NULL DEFAULT 'PENDING',
    created_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now()),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT timezone('utc', now())
);

-- Enable RLS
ALTER TABLE public.demo_requests ENABLE ROW LEVEL SECURITY;

-- Policy: Only authenticated owners can read demo requests
CREATE POLICY "Owners can view demo requests"
    ON public.demo_requests
    FOR SELECT
    TO authenticated
    USING (
        EXISTS (
            SELECT 1 FROM public.members
            WHERE members.auth_user_id = auth.uid()
              AND members.role = 'OWNER'
              AND members.active = true
        )
    );

-- Create secure submission RPC callable by anyone (anon and authenticated)
CREATE OR REPLACE FUNCTION public.submit_demo_request(payload JSONB)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
    v_full_name TEXT;
    v_business_name TEXT;
    v_mobile TEXT;
    v_email TEXT;
    v_business_type TEXT;
    v_preferred_date DATE;
    v_message TEXT;
    v_id UUID;
    v_clean_mobile TEXT;
BEGIN
    v_full_name := trim(COALESCE(payload->>'full_name', ''));
    v_business_name := trim(COALESCE(payload->>'business_name', ''));
    v_mobile := trim(COALESCE(payload->>'mobile', ''));
    v_email := lower(trim(COALESCE(payload->>'email', '')));
    v_business_type := trim(COALESCE(payload->>'business_type', 'General Business'));
    v_message := trim(COALESCE(payload->>'message', ''));

    IF payload->>'preferred_date' IS NOT NULL AND payload->>'preferred_date' <> '' THEN
        BEGIN
            v_preferred_date := (payload->>'preferred_date')::DATE;
        EXCEPTION WHEN OTHERS THEN
            v_preferred_date := NULL;
        END;
    ELSE
        v_preferred_date := NULL;
    END IF;

    -- Validations
    IF v_full_name = '' THEN
        RAISE EXCEPTION 'Full name is required' USING ERRCODE = 'P0001';
    END IF;

    IF v_business_name = '' THEN
        RAISE EXCEPTION 'Business name is required' USING ERRCODE = 'P0001';
    END IF;

    IF v_mobile = '' THEN
        RAISE EXCEPTION 'Mobile number is required' USING ERRCODE = 'P0001';
    END IF;

    -- Normalize Indian mobile (strip +91, 0, spaces, dashes)
    v_clean_mobile := regexp_replace(v_mobile, '[^0-9]', '', 'g');
    IF length(v_clean_mobile) = 12 AND v_clean_mobile LIKE '91%' THEN
        v_clean_mobile := substr(v_clean_mobile, 3);
    ELSIF length(v_clean_mobile) = 11 AND v_clean_mobile LIKE '0%' THEN
        v_clean_mobile := substr(v_clean_mobile, 2);
    END IF;

    IF length(v_clean_mobile) <> 10 THEN
        RAISE EXCEPTION 'Please provide a valid 10-digit mobile number' USING ERRCODE = 'P0001';
    END IF;

    IF v_email = '' OR position('@' in v_email) = 0 THEN
        RAISE EXCEPTION 'Please provide a valid email address' USING ERRCODE = 'P0001';
    END IF;

    INSERT INTO public.demo_requests (
        full_name,
        business_name,
        mobile,
        email,
        business_type,
        preferred_date,
        message,
        status
    ) VALUES (
        v_full_name,
        v_business_name,
        v_clean_mobile,
        v_email,
        v_business_type,
        v_preferred_date,
        NULLIF(v_message, ''),
        'PENDING'
    ) RETURNING id INTO v_id;

    RETURN jsonb_build_object(
        'success', true,
        'id', v_id,
        'message', 'Demo request received successfully. Our team will contact you shortly.'
    );
END;
$$;

-- Grant permissions for RPC
REVOKE ALL ON FUNCTION public.submit_demo_request(JSONB) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.submit_demo_request(JSONB) TO anon, authenticated;

