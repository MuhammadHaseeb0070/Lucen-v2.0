-- ============================================
-- Attachments Storage Bucket & RLS Policies (Idempotent)
-- ============================================

-- Ensure the 'attachments' bucket exists and is private
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES ('attachments', 'attachments', false, 10485760, null) -- 10MB limit
ON CONFLICT (id) DO NOTHING;

-- RLS policies for storage.objects on attachments bucket
DO $$
BEGIN
  -- INSERT policy: Allow authenticated users to upload files to their own folder segment (userId/)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
      AND tablename = 'objects' 
      AND policyname = 'Authenticated users can upload attachments to their own folder'
  ) THEN
    CREATE POLICY "Authenticated users can upload attachments to their own folder"
      ON storage.objects FOR INSERT
      TO authenticated
      WITH CHECK (
        bucket_id = 'attachments' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  -- SELECT policy: Allow authenticated users to read files from their own folder segment (userId/)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
      AND tablename = 'objects' 
      AND policyname = 'Authenticated users can read their own attachments'
  ) THEN
    CREATE POLICY "Authenticated users can read their own attachments"
      ON storage.objects FOR SELECT
      TO authenticated
      USING (
        bucket_id = 'attachments' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;

  -- DELETE policy: Allow authenticated users to delete files from their own folder segment (userId/)
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE schemaname = 'storage' 
      AND tablename = 'objects' 
      AND policyname = 'Authenticated users can delete their own attachments'
  ) THEN
    CREATE POLICY "Authenticated users can delete their own attachments"
      ON storage.objects FOR DELETE
      TO authenticated
      USING (
        bucket_id = 'attachments' AND
        (storage.foldername(name))[1] = auth.uid()::text
      );
  END IF;
END $$;
