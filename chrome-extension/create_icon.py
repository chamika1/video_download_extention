from PIL import Image, ImageDraw

# Create a 48x48 icon
size = 48
img = Image.new('RGBA', (size, size), (255, 255, 255, 0))
draw = ImageDraw.Draw(img)

# Draw a blue circle
margin = size // 8
draw.ellipse([margin, margin, size - margin, size - margin], 
             fill='#007bff')

# Draw a white arrow
arrow_points = [
    (size//2, size//3),    # Top point
    (size*2//3, size//2),  # Right point
    (size//2, size*2//3),  # Bottom point
    (size//2, size*7//12), # Inner bottom
    (size*5//12, size//2), # Inner left
    (size//2, size*5//12)  # Inner top
]
draw.polygon(arrow_points, fill='white')

# Save the icon
img.save('icon.png') 