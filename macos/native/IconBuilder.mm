#import <Foundation/Foundation.h>
#import <CoreGraphics/CoreGraphics.h>
#import <ImageIO/ImageIO.h>
#include <cmath>
#include <cstdio>
#include <initializer_list>

// Scale only: the latest supplied PNG owns the artwork, corner shape and alpha.
// Mac adds transparent outer margins without redrawing or clipping the source.
static bool png(CGImageRef source, size_t side, NSString *file) {
    CGColorSpaceRef color = CGColorSpaceCreateDeviceRGB();
    CGContextRef context = CGBitmapContextCreate(nullptr, side, side, 8, side * 4, color,
        kCGImageAlphaPremultipliedLast | kCGBitmapByteOrder32Big);
    CGColorSpaceRelease(color);
    if (!context) return false;
    const double artwork = side * 832.0 / 1024.0, inset = (side - artwork) / 2;
    CGContextClearRect(context, CGRectMake(0, 0, side, side));
    CGContextSetInterpolationQuality(context, kCGInterpolationHigh);
    CGContextDrawImage(context, CGRectMake(inset, inset, artwork, artwork), source);
    CGImageRef image = CGBitmapContextCreateImage(context);
    CGImageDestinationRef output = CGImageDestinationCreateWithURL(
        (__bridge CFURLRef)[NSURL fileURLWithPath:file], CFSTR("public.png"), 1, nullptr);
    bool ok = false;
    if (output) {
        CGImageDestinationAddImage(output, image, nullptr);
        ok = CGImageDestinationFinalize(output); CFRelease(output);
    }
    CGImageRelease(image); CGContextRelease(context);
    return ok;
}
int main(int argc, const char *argv[]) {
    @autoreleasepool {
        if (argc != 4) return 1;
        CGImageSourceRef input = CGImageSourceCreateWithURL(
            (__bridge CFURLRef)[NSURL fileURLWithPath:@(argv[1])], nullptr);
        if (!input) return 1;
        CGImageRef image = CGImageSourceCreateImageAtIndex(input, 0, nullptr); CFRelease(input);
        if (!image || CGImageGetWidth(image) != CGImageGetHeight(image)) return 1;
        bool ok = png(image, 1024, @(argv[2]));
        for (int size : {16, 32, 128, 256, 512})
            for (int scale : {1, 2}) {
                NSString *name = [NSString stringWithFormat:@"icon_%dx%d%@.png", size, size, scale == 2 ? @"@2x" : @""];
                ok = png(image, size * scale, [@(argv[3]) stringByAppendingPathComponent:name]) && ok;
            }
        CGImageRelease(image);
        if (ok) puts("Mac icon: supplied contour and alpha preserved, 832 artwork on 1024 canvas, 96 transparent inset per side.");
        return ok ? 0 : 1;
    }
}
