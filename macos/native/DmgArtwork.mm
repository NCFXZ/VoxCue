#import <AppKit/AppKit.h>
#include <cstdio>

// The preview and the shipped background share this exact artwork and layout.
// This is offscreen drawing; it never captures the screen or opens a window.
static NSColor *rgb(unsigned int value) {
    return [NSColor colorWithSRGBRed:((value >> 16) & 255) / 255.0
        green:((value >> 8) & 255) / 255.0 blue:(value & 255) / 255.0 alpha:1];
}
static NSRect rect(double x, double y, double w, double h, double height) {
    return NSMakeRect(x, height - y - h, w, h);
}
static void text(NSString *value, NSRect box, double size, NSFontWeight weight, NSColor *color) {
    NSMutableParagraphStyle *style = [[NSMutableParagraphStyle alloc] init];
    style.alignment = NSTextAlignmentCenter;
    [value drawInRect:box withAttributes:@{
        NSFontAttributeName:[NSFont systemFontOfSize:size weight:weight],
        NSForegroundColorAttributeName:color, NSParagraphStyleAttributeName:style
    }];
}
static NSData *render(NSDictionary *layout, NSString *logoPath, NSString *destination, int scale, bool preview) {
    const double w = [layout[@"width"] doubleValue], h = [layout[@"height"] doubleValue];
    NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc] initWithBitmapDataPlanes:nullptr
        pixelsWide:w * scale pixelsHigh:h * scale bitsPerSample:8 samplesPerPixel:4
        hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace bytesPerRow:0 bitsPerPixel:0];
    bitmap.size = NSMakeSize(w, h);
    [NSGraphicsContext saveGraphicsState];
    [NSGraphicsContext setCurrentContext:[NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap]];
    // bitmap.size supplies the logical point size; AppKit applies Retina scaling.
    [rgb(0xF6F8FA) setFill]; NSRectFill(NSMakeRect(0, 0, w, h));
    NSDictionary *application = layout[@"application"], *target = layout[@"destination"];
    const double ax = [application[@"x"] doubleValue], dx = [target[@"x"] doubleValue];
    const double cx = (ax + dx) / 2, cy = ([application[@"y"] doubleValue] + [target[@"y"] doubleValue]) / 2;
    NSBezierPath *card = [NSBezierPath bezierPathWithRoundedRect:rect(ax - 106, cy - 67, dx - ax + 212, 151, h)
        xRadius:20 yRadius:20];
    [rgb(0xFFFFFF) setFill]; [card fill];
    [rgb(0xE1E6EB) setStroke]; card.lineWidth = 1; [card stroke];
    NSImage *logo = [[NSImage alloc] initWithContentsOfFile:logoPath];
    [logo drawInRect:rect(w / 2 - 78, 40, 38, 38, h)];
    text(@"VoxCue", rect(w / 2 - 33, 40, 118, 38, h), 28, NSFontWeightSemibold, rgb(0x1C252B));
    text(layout[@"subtitle"], rect(24, 94, w - 48, 26, h), 14, NSFontWeightRegular, rgb(0x606A70));
    NSBezierPath *arrow = [NSBezierPath bezierPath];
    [arrow moveToPoint:NSMakePoint(cx - 22, h - cy)];
    [arrow lineToPoint:NSMakePoint(cx + 22, h - cy)];
    [arrow moveToPoint:NSMakePoint(cx + 13, h - cy + 9)];
    [arrow lineToPoint:NSMakePoint(cx + 22, h - cy)];
    [arrow lineToPoint:NSMakePoint(cx + 13, h - cy - 9)];
    arrow.lineWidth = 3; arrow.lineCapStyle = NSLineCapStyleRound;
    arrow.lineJoinStyle = NSLineJoinStyleRound;
    [rgb(0x0067B4) setStroke]; [arrow stroke];
    [rgb(0xE1E6EB) setFill]; NSRectFill(rect(64, h - 74, w - 128, 1, h));
    text(layout[@"footer"], rect(24, h - 53, w - 48, 24, h), 12, NSFontWeightRegular, rgb(0x606A70));
    if (preview) {
        const double size = [layout[@"iconSize"] doubleValue];
        // Offline previews can receive a placeholder from IconServices. The system
        // Applications artwork is preview-only; Finder supplies the real link icon.
        NSImage *folder = [[NSImage alloc] initWithContentsOfFile:
            @"/System/Library/CoreServices/CoreTypes.bundle/Contents/Resources/ApplicationsFolderIcon.icns"];
        if (!folder) folder = [[NSWorkspace sharedWorkspace] iconForFile:destination];
        for (NSString *key in @[@"application", @"destination"]) {
            NSDictionary *item = layout[key];
            const double x = [item[@"x"] doubleValue], y = [item[@"y"] doubleValue];
            [([key isEqualToString:@"application"] ? logo : folder) drawInRect:rect(x - size / 2, y - size / 2, size, size, h)];
            text([key isEqualToString:@"application"] ? @"VoxCue" : item[@"name"], rect(x - 90, y + size / 2 + 5, 180, 22, h),
                [layout[@"textSize"] doubleValue], NSFontWeightRegular, rgb(0x1C252B));
        }
    }
    [NSGraphicsContext restoreGraphicsState];
    return [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 5) return 1;
        NSDictionary *layout = [NSJSONSerialization JSONObjectWithData:
            [NSData dataWithContentsOfFile:@(argv[1])] options:0 error:nil];
        if (!layout) return 1;
        if ([@(argv[3]) isEqualToString:@"--preview"]) {
            NSData *data = render(layout, @(argv[2]), @(argv[4]), 2, true);
            return fwrite(data.bytes, 1, data.length, stdout) == data.length ? 0 : 1;
        }
        for (int scale = 1; scale <= 2; ++scale) {
            NSString *name = scale == 1 ? @"background.png" : @"background@2x.png";
            if (![render(layout, @(argv[2]), @(argv[4]), scale, false)
                writeToFile:[@(argv[3]) stringByAppendingPathComponent:name] atomically:YES]) return 1;
        }
        return 0;
    }
}
