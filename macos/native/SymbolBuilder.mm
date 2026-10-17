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
            NSImageSymbolConfiguration *configuration = [NSImageSymbolConfiguration
                configurationWithPointSize:20 weight:NSFontWeightRegular scale:NSImageSymbolScaleMedium];
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
            CGFloat ratio = MIN(20.0 / size.width, 20.0 / size.height);
            size = NSMakeSize(size.width * ratio, size.height * ratio);
            [symbol drawInRect:NSMakeRect((24-size.width)/2, (24-size.height)/2, size.width, size.height)
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
