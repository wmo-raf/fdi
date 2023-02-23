import os
from datetime import datetime
from pathlib import Path
import glob
import re

DATA_PATH = os.getenv('DATA_PATH')

def clean_up():
    if DATA_PATH and os.path.isdir(DATA_PATH):
        data_dir = os.path.abspath(DATA_PATH)
        pattern = f"{data_dir}/**/*.tif"
        current_date = datetime.utcnow().date()
        for f in glob.iglob(pattern, recursive=True):
            try:
                filename = Path(f).stem
                match = re.search("(\d{4})[/.-](\d{2})[/.-](\d{2})T(\d{2}):(\d{2}):(\d{2})[/..](\d{3})Z$", filename)
                if match:
                    date_str = match.group()
                    file_date = datetime.strptime(date_str, "%Y-%m-%dT%H:%M:%S.%fZ").date()
                    if file_date < current_date:
                        os.remove(f)
                        print(f"Deleted {f}")
            except Exception as e:
                print(e)

if __name__ == "__main__":
   clean_up()