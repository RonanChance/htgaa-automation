import boto3
import os
from dotenv import load_dotenv

dotenv_path = os.path.join(os.path.dirname(__file__), '..', '..', '.env')
load_dotenv(dotenv_path)

s3 = boto3.client(
    's3',
    region_name='nyc3',
    endpoint_url='https://nyc3.digitaloceanspaces.com',
    aws_access_key_id=os.environ['DO_SPACES_KEY'],
    aws_secret_access_key=os.environ['DO_SPACES_SECRET']
)

# List objects in 68-lab
resp = s3.list_objects_v2(Bucket='ginkgo-artworks', Prefix='68-lab/')
for obj in resp.get('Contents', []):
    print(obj['Key'])