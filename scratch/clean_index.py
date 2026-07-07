import sys
import os

file_path = r'c:\Shihab\Projects\Apps\node\Media-server\index.html'
with open(file_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

del lines[2410:2438]

with open(file_path, 'w', encoding='utf-8') as f:
    f.writelines(items.tags)