from PIL import Image

def run():
    logo_path = '/Users/ncomeaux/VsCode and Antigravity/CMX Logic/cmx-logic-web/assets/logo.png'
    out_dark = '/Users/ncomeaux/VsCode and Antigravity/CMX Logic/cmx-logic-web/assets/logo_dark.png'
    
    img = Image.open(logo_path).convert("RGBA")
    data = img.getdata()
    new_data = []
    
    for r, g, b, a in data:
        # white background -> transparent
        if r > 200 and g > 200 and b > 200:
            new_data.append((255, 255, 255, 0))
        else:
            # If the pixel does not have a high red channel, it's the dark "CM".
            # The orange "X" will have a high Red channel (e.g. 200+).
            # Convert the dark CM to white for visibility on dark backgrounds.
            if r < 160:
                new_data.append((255, 255, 255, a))
            else:
                new_data.append((r, g, b, a))
                
    img.putdata(new_data)
    img.save(out_dark)
    print("Dark mode logo successfully generated!")

if __name__ == '__main__':
    run()
