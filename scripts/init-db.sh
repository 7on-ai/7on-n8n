#!/bin/bash
set -e

echo "📊 Initializing PostgreSQL database schema..."

# ✅ FIX: รับ connection string จาก argument แทน environment variable
DB_URI="$1"

if [ -z "$DB_URI" ]; then
  echo "⚠️  Usage: $0 <database_uri>"
  echo "⚠️  Database URI not provided, skipping initialization"
  exit 0
fi

# แสดง connection string (ซ่อน password)
SAFE_URI=$(echo "$DB_URI" | sed 's/:\/\/[^:]*:[^@]*@/:\/\/***:***@/')
echo "🔗 Using: $SAFE_URI"

# ทดสอบ connection
echo "🔌 Testing database connection..."
if ! psql "$DB_URI" -c 'SELECT current_user, current_database();' 2>&1; then
  echo "❌ Cannot connect to database"
  exit 1
fi

# ตรวจสอบ permissions
echo "🔐 Checking permissions..."
psql "$DB_URI" -c "
  SELECT 
    has_database_privilege(current_database(), 'CREATE') as can_create_schema,
    has_database_privilege(current_database(), 'CONNECT') as can_connect;
" || {
  echo "❌ Insufficient permissions!"
  echo "📋 User: $(psql "$DB_URI" -tAc 'SELECT current_user;')"
  echo "📋 Database: $(psql "$DB_URI" -tAc 'SELECT current_database();')"
  exit 1
}

echo "🧩 Installing pgvector extension..."
psql "$DB_URI" -c 'CREATE EXTENSION IF NOT EXISTS vector;' || {
  echo "⚠️  Could not create vector extension (may already exist or need superuser)"
}

echo "📂 Creating schema..."
psql "$DB_URI" -c 'CREATE SCHEMA IF NOT EXISTS user_data_schema;' || {
  echo "❌ Failed to create schema!"
  exit 1
}

echo "📋 Creating tables..."
psql "$DB_URI" << 'EOSQL'
CREATE TABLE IF NOT EXISTS user_data_schema.ethical_profiles (
  user_id TEXT PRIMARY KEY,
  self_awareness FLOAT DEFAULT 0.3,
  emotional_regulation FLOAT DEFAULT 0.4,
  compassion FLOAT DEFAULT 0.4,
  integrity FLOAT DEFAULT 0.5,
  growth_mindset FLOAT DEFAULT 0.4,
  wisdom FLOAT DEFAULT 0.3,
  transcendence FLOAT DEFAULT 0.2,
  growth_stage INT DEFAULT 2,
  total_interactions INT DEFAULT 0,
  breakthrough_moments INT DEFAULT 0,
  crisis_interventions INT DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  last_calculated_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS user_data_schema.interaction_memories (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  text TEXT NOT NULL,
  embedding vector(768),
  classification TEXT NOT NULL,
  ethical_scores JSONB NOT NULL DEFAULT '{}',
  moments JSONB DEFAULT '[]',
  reflection_prompt TEXT,
  gentle_guidance TEXT,
  approved_for_training BOOLEAN DEFAULT FALSE,
  training_weight FLOAT DEFAULT 1.0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_data_schema.memory_embeddings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  content TEXT NOT NULL,
  embedding vector(768),
  interaction_memory_id BIGINT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_data_schema.chat_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  started_at TIMESTAMP NOT NULL,
  last_message_at TIMESTAMP NOT NULL,
  ended_at TIMESTAMP,
  status TEXT DEFAULT 'active',
  message_count INT DEFAULT 0,
  processed BOOLEAN DEFAULT FALSE,
  processed_at TIMESTAMP,
  metadata JSONB,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_data_schema.raw_messages (
  id SERIAL PRIMARY KEY,
  session_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL,
  timestamp TIMESTAMP DEFAULT NOW(),
  metadata JSONB
);

CREATE TABLE IF NOT EXISTS user_data_schema.growth_milestones (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  milestone_type TEXT NOT NULL,
  previous_state JSONB,
  new_state JSONB,
  trigger_interaction_id BIGINT,
  description TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_data_schema.training_jobs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  job_id TEXT NOT NULL,
  job_name TEXT NOT NULL,
  adapter_version TEXT NOT NULL,
  status TEXT DEFAULT 'pending',
  started_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  dataset_composition JSONB DEFAULT '{}',
  total_samples INT DEFAULT 0,
  ethical_profile_snapshot JSONB DEFAULT '{}',
  growth_stage_at_training INT,
  training_loss FLOAT,
  final_metrics JSONB DEFAULT '{}',
  error_message TEXT,
  retry_count INT DEFAULT 0,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS user_data_schema.gating_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  input_text TEXT NOT NULL,
  classification TEXT,
  ethical_scores JSONB,
  growth_stage INT,
  moments JSONB DEFAULT '[]',
  reflection_prompt TEXT,
  gentle_guidance TEXT,
  processing_time_ms INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
EOSQL

echo "🔍 Creating indexes..."
psql "$DB_URI" << 'EOSQL'
CREATE INDEX IF NOT EXISTS idx_interaction_user ON user_data_schema.interaction_memories(user_id);
CREATE INDEX IF NOT EXISTS idx_interaction_classification ON user_data_schema.interaction_memories(classification);
CREATE INDEX IF NOT EXISTS idx_interaction_embedding ON user_data_schema.interaction_memories USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_memory_embeddings_vector ON user_data_schema.memory_embeddings USING hnsw (embedding vector_cosine_ops);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user_status ON user_data_schema.chat_sessions(user_id, status);
CREATE INDEX IF NOT EXISTS idx_raw_messages_session ON user_data_schema.raw_messages(session_id);
CREATE INDEX IF NOT EXISTS idx_raw_messages_user_time ON user_data_schema.raw_messages(user_id, timestamp DESC);
EOSQL

echo "🔗 Creating foreign keys..."
psql "$DB_URI" << 'EOSQL'
DO $$ 
BEGIN 
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'raw_messages_session_fk'
  ) THEN 
    ALTER TABLE user_data_schema.raw_messages 
    ADD CONSTRAINT raw_messages_session_fk 
    FOREIGN KEY (session_id) 
    REFERENCES user_data_schema.chat_sessions(id) 
    ON DELETE CASCADE; 
  END IF; 
END $$;
EOSQL

echo "🔐 Granting permissions..."
psql "$DB_URI" << 'EOSQL'
GRANT USAGE ON SCHEMA user_data_schema TO current_user;
GRANT ALL ON ALL TABLES IN SCHEMA user_data_schema TO current_user;
GRANT ALL ON ALL SEQUENCES IN SCHEMA user_data_schema TO current_user;
EOSQL

echo "✅ Database schema initialized successfully!"
