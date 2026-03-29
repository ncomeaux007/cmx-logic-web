from PIL import Image
import os

def run():
    logo_path = '/Users/ncomeaux/VsCode and Antigravity/CMX Logic/cmx-logic-web/assets/logo.png'
    out_path = '/Users/ncomeaux/VsCode and Antigravity/CMX Logic/cmx-logic-web/assets/logo_transparent.png'
    
    img = Image.open(logo_path).convert("RGBA")
    data = img.getdata()
    new_data = []
    
    for item in data:
        if item[0] > 220 and item[1] > 220 and item[2] > 220:
            new_data.append((255, 255, 255, 0))
        else:
            new_data.append(item)
            
    img.putdata(new_data)
    img.save(out_path)
    print("Logo transparency generated at " + out_path)

if __name__ == '__main__':
    run()
