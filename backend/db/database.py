import os
import motor.motor_asyncio
from dotenv import load_dotenv

# Load env variables from the project root folder
root_dir = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
load_dotenv(os.path.join(root_dir, ".env.local"))

# Connect to local MongoDB
MONGO_URL = os.environ.get("MONGO_URL") or os.environ.get(
    "MONGODB_URI", "mongodb://localhost:27017"
)
client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)

# Setup Database and Collections
db = client.ai_chatbot_db
conversations_collection = db.get_collection("conversations")
messages_collection = db.get_collection("messages")
workspaces_collection = db.get_collection("workspaces")
workspace_files_collection = db.get_collection("workspace_files")
conversation_turns_collection = db.get_collection("conversation_turns")
runs_collection = db.get_collection("runs")
run_steps_collection = db.get_collection("run_steps")
run_events_collection = db.get_collection("run_events")
agent_traces_collection = db.get_collection("agent_traces")
agent_trace_events_collection = db.get_collection("agent_trace_events")
agent_debug_payloads_collection = db.get_collection("agent_debug_payloads")
gridfs_bucket = motor.motor_asyncio.AsyncIOMotorGridFSBucket(
    db, bucket_name=os.environ.get("GRIDFS_BUCKET_NAME", "workspace_files_fs")
)
