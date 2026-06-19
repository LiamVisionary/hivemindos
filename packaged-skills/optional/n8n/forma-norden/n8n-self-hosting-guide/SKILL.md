---
name: n8n-self-hosting-guide
description: Use this skill to deploy and manage a self-hosted n8n instance for production GTM automation. Use for: self-host n8n, Docker, PostgreSQL, queue mode, scaling, backups.
license: MIT
---
# n8n-self-hosting-guide

Use this skill to deploy and manage a self-hosted n8n instance for
production GTM automation.

## Infrastructure Options

| Option | Cost | Best For |
|--------|------|----------|
| Docker Compose (single server) | $55-80/month | Teams running < 5,000 executions/day |
| Docker + Queue Mode | $100-140/month | Teams running 5,000-50,000 executions/day |
| Kubernetes | $200+/month | Enterprise with high availability requirements |
| n8n Cloud | $24-120/month | Teams that prefer managed infrastructure |

## Docker Compose Setup (Recommended Start)

### Required Components

1. **n8n container** running the application
2. **PostgreSQL container** for workflow storage (never use SQLite in production)
3. **Redis container** (if using queue mode)
4. **Reverse proxy** (Caddy or Nginx) for HTTPS

### Minimum Server Specifications

| Component | Minimum | Recommended |
|-----------|---------|-------------|
| CPU | 2 cores | 4 cores |
| RAM | 4 GB | 8 GB |
| Storage | 20 GB SSD | 50 GB SSD |
| OS | Ubuntu 22.04 LTS | Ubuntu 22.04 LTS |

### Essential Environment Variables

```env
N8N_ENCRYPTION_KEY=[generate with openssl rand -hex 32]
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=postgres
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n
DB_POSTGRESDB_PASSWORD=[strong-password]
N8N_HOST=n8n.yourdomain.com
N8N_PROTOCOL=https
WEBHOOK_URL=https://n8n.yourdomain.com/
N8N_BASIC_AUTH_ACTIVE=true
N8N_BASIC_AUTH_USER=[admin-user]
N8N_BASIC_AUTH_PASSWORD=[strong-password]
EXECUTIONS_MODE=regular
```

## Queue Mode Setup

Switch to queue mode when executions per day exceed 5,000 or when
workflow reliability is critical.

### Why Queue Mode

- Separates UI process from execution workers
- Workers can be scaled independently
- Failed executions do not crash the UI
- Better resource utilization

### Additional Environment Variables for Queue Mode

```env
EXECUTIONS_MODE=queue
QUEUE_BULL_REDIS_HOST=redis
QUEUE_BULL_REDIS_PORT=6379
QUEUE_HEALTH_CHECK_ACTIVE=true
```

### Scaling Workers

Add additional worker containers pointing to the same PostgreSQL and Redis.
Each worker processes executions independently.

Start with 2 workers, add more based on queue depth monitoring.

## Backup Strategy

| What | How | Frequency |
|------|-----|-----------|
| PostgreSQL database | pg_dump to S3/backup storage | Daily |
| n8n encryption key | Store in secrets manager | One-time |
| Workflow exports | n8n CLI export all workflows to JSON | Weekly |
| Environment variables | Store in secrets manager or encrypted file | On change |

## Monitoring Checklist

| Check | Tool | Alert |
|-------|------|-------|
| n8n health endpoint | /healthz | If down for > 2 min |
| PostgreSQL connections | pg_stat_activity | If > 80% connection limit |
| Disk usage | System monitoring | If > 80% capacity |
| Failed executions | n8n error workflow | On every failure |
| Queue depth (queue mode) | Redis LLEN | If > 100 pending |
| Worker health | Queue health check | If worker offline |

## Execution Sequence

1. Choose infrastructure option based on execution volume.
2. Provision server meeting minimum specifications.
3. Deploy using Docker Compose with PostgreSQL.
4. Configure HTTPS via reverse proxy.
5. Set up backup strategy for database and encryption key.
6. Configure monitoring and alerting.
7. Test with sample workflows before migrating production.

## Output Contract

Return:

- deployment architecture recommendation based on requirements
- Docker Compose configuration or modification instructions
- environment variable configuration
- backup and monitoring setup
- scaling plan with trigger thresholds

## Anti-Patterns

- using SQLite in production (data corruption risk)
- not backing up the encryption key (permanent data loss)
- running UI and workers in the same process at scale
- no monitoring on production instances
- storing credentials in workflow JSON instead of n8n credential manager
