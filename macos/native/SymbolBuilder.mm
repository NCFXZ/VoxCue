#import <AppKit/AppKit.h>
#include <cstdio>

// Use Apple's installed system symbols. Only monochrome alpha assets for this
// Mac app are produced; no copied font, third-party pack, or runtime native API.
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 3) return 1;
        NSError *error = nil;
        NSData *data = [NSData dataWithContentsOfFile:@(argv[1])];
        NSDictionary *symbols = data ? [NSJSONSerialization JSONObjectWithData:data options:0 error:&error] : nil;
        if (![symbols isKindOfClass:[NSDictionary class]]) return 1;
        for (NSString *key in [[symbols allKeys] sortedArrayUsingSelector:@selector(compare:)]) {
            NSString *name = symbols[key];
            if (![name isKindOfClass:[NSString class]]) return 1;
            NSImage *symbol = [NSImage imageWithSystemSymbolName:name accessibilityDescription:nil];
            if (!symbol) { fprintf(stderr, "Unavailable SF Symbol: %s\n", [name UTF8String]); return 1; }
            BOOL fontDecrease = [key isEqualToString:@"FontDecrease"];
            BOOL fontIncrease = [key isEqualToString:@"FontIncrease"];
            BOOL fontAdjustment = fontDecrease || fontIncrease;
            NSImageSymbolConfiguration *configuration = [NSImageSymbolConfiguration
                configurationWithPointSize:20
                weight:fontAdjustment ? NSFontWeightSemibold : NSFontWeightRegular
                scale:NSImageSymbolScaleMedium];
            symbol = [symbol imageWithSymbolConfiguration:configuration];
            const NSInteger side = 192;
            NSBitmapImageRep *bitmap = [[NSBitmapImageRep alloc]
                initWithBitmapDataPlanes:nullptr pixelsWide:side pixelsHigh:side bitsPerSample:8
                samplesPerPixel:4 hasAlpha:YES isPlanar:NO colorSpaceName:NSDeviceRGBColorSpace
                bytesPerRow:side * 4 bitsPerPixel:32];
            if (!bitmap) return 1;
            NSGraphicsContext *context = [NSGraphicsContext graphicsContextWithBitmapImageRep:bitmap];
            [NSGraphicsContext saveGraphicsState];
            [NSGraphicsContext setCurrentContext:context];
            CGContextRef cg = [context CGContext];
            CGContextClearRect(cg, CGRectMake(0, 0, side, side));
            CGContextScaleCTM(cg, 8, 8); // 24pt canvas at 8x for Retina and larger UI controls.
            NSSize size = [symbol size];
            // Normalizing both native A glyphs to 20pt erases their size cue.
            // Keep a clear small/large pair on one baseline, including at 16px.
            CGFloat extent = fontDecrease ? 14.0 : fontIncrease ? 22.0 : 20.0;
            CGFloat ratio = MIN(extent / size.width, extent / size.height);
            size = NSMakeSize(size.width * ratio, size.height * ratio);
            CGFloat bottom = fontAdjustment ? 2.0 : (24-size.height)/2;
            [symbol drawInRect:NSMakeRect((24-size.width)/2, bottom, size.width, size.height)
                fromRect:NSZeroRect operation:NSCompositingOperationCopy fraction:1.0
                respectFlipped:NO hints:nil];
            [NSGraphicsContext restoreGraphicsState];
            NSData *png = [bitmap representationUsingType:NSBitmapImageFileTypePNG properties:@{}];
            NSString *file = [@(argv[2]) stringByAppendingPathComponent:[key stringByAppendingString:@".png"]];
            if (!png || ![png writeToFile:file options:NSDataWritingAtomic error:&error]) return 1;
        }
        printf("Generated %lu Mac SF Symbols from AppKit (192px alpha masks).\n", (unsigned long)[symbols count]);
    }
    return 0;
}
