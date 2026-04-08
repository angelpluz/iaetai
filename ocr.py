import sys
import io
import os
import warnings

# Force UTF-8 output on Windows
if sys.stdout.encoding != 'utf-8':
    sys.stdout = io.TextIOWrapper(sys.stdout.buffer, encoding='utf-8')

warnings.filterwarnings("ignore")

import easyocr

def main():
    image_path = sys.argv[1] if len(sys.argv) > 1 else "temp.png"
    reader = easyocr.Reader(["th", "en"], gpu=False, verbose=False)
    results = reader.readtext(image_path, detail=0, paragraph=False)
    print("\n".join(results))

if __name__ == "__main__":
    main()


if __name__ == "__main__":
    main()
