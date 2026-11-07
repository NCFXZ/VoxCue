using System.Drawing;
using System.Drawing.Drawing2D;
using System.Drawing.Imaging;
using System.IO;

static class StoreAssets
{
    static void Main(string[] args)
    {
        using (var logo = Image.FromFile(args[0]))
        {
            Save(logo, args[1], "StoreLogo", 50, 50);
            Save(logo, args[1], "Square44x44Logo", 44, 44);
            Save(logo, args[1], "Square150x150Logo", 150, 150);
            Save(logo, args[1], "Wide310x150Logo", 310, 150);

            // The shell adds a colored plate unless the taskbar icon has theme variants.
            var targetSizes = new[] { 16, 20, 24, 30, 32, 36, 40, 48, 60, 64, 72, 80, 96, 256 };
            var variants = new[] { "", "_altform-unplated", "_altform-lightunplated" };
            foreach (var size in targetSizes)
                foreach (var variant in variants)
                    Save(logo, args[1], "Square44x44Logo.targetsize-" + size + variant, size, size);
        }
    }

    static void Save(Image logo, string directory, string name, int width, int height)
    {
        using (var bitmap = new Bitmap(width, height, PixelFormat.Format32bppArgb))
        using (var graphics = Graphics.FromImage(bitmap))
        {
            graphics.InterpolationMode = InterpolationMode.HighQualityBicubic;
            graphics.DrawImage(logo, (width - height) / 2, 0, height, height);
            bitmap.Save(Path.Combine(directory, name + ".png"), ImageFormat.Png);
        }
    }
}
