import os

from redis import Redis
from redis.asyncio import Redis as AsyncRedis


REDIS_URL = os.environ.get("REDIS_URL", "redis://127.0.0.1:6379/0")

redis_client = Redis.from_url(REDIS_URL, decode_responses=True)
redis_async_client = AsyncRedis.from_url(REDIS_URL, decode_responses=True)
