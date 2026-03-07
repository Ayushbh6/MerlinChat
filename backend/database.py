import os
import motor.motor_asyncio
from dotenv import load_dotenv

# Load env variables from the root folder
root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
load_dotenv(os.path.join(root_dir, ".env.local"))

# Connect to local MongoDB
MONGO_URL = os.environ.get("MONGO_URL", "mongodb://localhost:27017")
client = motor.motor_asyncio.AsyncIOMotorClient(MONGO_URL)

# Setup Database and Collections
db = client.ai_chatbot_db
conversations_collection = db.get_collection("conversations")
messages_collection = db.get_collection("messages")
