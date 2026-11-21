// Types for kit.mjs, for the tests that read the kit's companion art.
export declare const ROOT: string;
export declare const KIT_MAJOR: number;
/** Where the Atelier kit is; throws with what to do when there's none. */
export declare function findKit(): string;
/** Problems with a kit for this game (missing files it imports, another three.js). */
export declare function checkKit(dir: string, addons: readonly string[]): string[];
export declare function kitVersion(dir: string): string;
export declare function kitAddons(): string[];
