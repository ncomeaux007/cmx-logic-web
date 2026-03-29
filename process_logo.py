import os
from PIL import Image

logo_path = 'assets/logo.png'
if not os.path.exists(logo_path):
    print(f"Could not find {logo_path}")
    exit(1)

try:
    img = Image.open(logo_path).convert("RGBA")
    data = img.getdata()

    new_data = []
    
    for item in data:
        # If the pixel is close to white (background), make it transparent
        if item[0] > 215 and item[1] > 215 and item[2] > 215:
            new_data.append((255, 255, 255, 0))
        else:
            # Keep original colors!
            new_data.append(item)

    img_transparent = Image.new("RGBA", img.size)
    img_transparent.putdata(new_data)
    img_transparent.save('assets/logo_transparent.png')
    
    # Also create an all-white version for dark mode if original is too dark
    white_data = []
    for item in data:
        if item[0] > 215 and item[1] > 215 and item[2] > 215:
            white_data.append((255, 255, 255, 0))
        else:
            white_data.append((255, 255, 255, item[3]))
            
    img_white = Image.new("RGBA", img.size)
    img_white.putdata(white_data)
    img_white.save('assets/logo_white.png')
    
    print("Logos successfully generated!")
except Exception as e:
    print(f"Error processing image: {e}")

