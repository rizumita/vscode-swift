//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as fs from "fs/promises";
import * as path from "path";
import * as plist from "plist";
import * as vscode from "vscode";
import configuration from "../configuration";
import { SwiftOutputChannel } from "../ui/SwiftOutputChannel";
import { execFile, execSwift, pathExists } from "../utilities/utilities";
import { Version } from "../utilities/version";

/**
 * Contents of **Info.plist** on Windows.
 */
interface InfoPlist {
    DefaultProperties: {
        XCTEST_VERSION: string | undefined;
    };
}

/**
 * Stripped layout of `swift -print-target-info` output.
 */
interface SwiftTargetInfo {
    compilerVersion: string;
    target?: {
        triple: string;
        [name: string]: string | string[];
    };
    paths: {
        runtimeLibraryPaths: string[];
        [name: string]: string | string[];
    };
    [name: string]: string | object | undefined;
}

/**
 * A Swift compilation target that can be compiled to
 * from macOS. These are similar to XCode's target list.
 */
export enum DarwinCompatibleTarget {
    iOS = "iOS",
    tvOS = "tvOS",
    watchOS = "watchOS",
}

export function getDarwinSDKName(target: DarwinCompatibleTarget): string {
    switch (target) {
        case DarwinCompatibleTarget.iOS:
            return "iphoneos";
        case DarwinCompatibleTarget.tvOS:
            return "appletvos";
        case DarwinCompatibleTarget.watchOS:
            return "watchos";
    }
}

export function getDarwinTargetTriple(target: DarwinCompatibleTarget): string | undefined {
    switch (target) {
        case DarwinCompatibleTarget.iOS:
            return "arm64-apple-ios";
        case DarwinCompatibleTarget.tvOS:
            return "arm64-apple-tvos";
        case DarwinCompatibleTarget.watchOS:
            return "arm64-apple-watchos";
    }
}

export class SwiftToolchain {
    constructor(
        public swiftFolderPath: string,
        public toolchainPath: string,
        public swiftVersionString: string,
        public swiftVersion: Version,
        public runtimePath?: string,
        private defaultTarget?: string,
        private defaultSDK?: string,
        private customSDK?: string,
        public xcTestPath?: string
    ) {}

    static async create(): Promise<SwiftToolchain> {
        const swiftFolderPath = await this.getSwiftFolderPath();
        const toolchainPath = await this.getToolchainPath(swiftFolderPath);
        const targetInfo = await this.getSwiftTargetInfo();
        const swiftVersion = await this.getSwiftVersion(targetInfo);
        const runtimePath = await this.getRuntimePath(targetInfo);
        const defaultSDK = await this.getDefaultSDK();
        const customSDK = this.getCustomSDK();
        const xcTestPath = await this.getXCTestPath(
            targetInfo,
            swiftVersion,
            runtimePath,
            customSDK ?? defaultSDK
        );
        return new SwiftToolchain(
            swiftFolderPath,
            toolchainPath,
            targetInfo.compilerVersion,
            swiftVersion,
            runtimePath,
            targetInfo.target?.triple,
            defaultSDK,
            customSDK,
            xcTestPath
        );
    }

    /**
     * Get active developer dir for Xcode
     */
    public static async getXcodeDeveloperDir(env?: { [key: string]: string }): Promise<string> {
        const { stdout } = await execFile("xcode-select", ["-p"], {
            env: env,
        });
        return stdout.trimEnd();
    }

    /**
     * @param target Target to obtain the SDK path for
     * @returns path to the SDK for the target
     */
    public static async getSDKForTarget(
        target: DarwinCompatibleTarget
    ): Promise<string | undefined> {
        return await this.getSDKPath(getDarwinSDKName(target));
    }

    /**
     * @param sdk sdk name
     * @returns path to the SDK
     */
    static async getSDKPath(sdk: string): Promise<string | undefined> {
        // Include custom variables so that non-standard XCode installs can be better supported.
        const { stdout } = await execFile("xcrun", ["--sdk", sdk, "--show-sdk-path"], {
            env: { ...process.env, ...configuration.swiftEnvironmentVariables },
        });
        return path.join(stdout.trimEnd());
    }

    /**
     * Get list of Xcode versions intalled on mac
     * @returns Folders for each Xcode install
     */
    public static async getXcodeInstalls(): Promise<string[]> {
        const { stdout: xcodes } = await execFile("mdfind", [
            `kMDItemCFBundleIdentifier == 'com.apple.dt.Xcode'`,
        ]);
        return xcodes.trimEnd().split("\n");
    }

    /**
     * Return fullpath for toolchain executable
     */
    public getToolchainExecutable(exe: string): string {
        return `${this.toolchainPath}/usr/bin/${exe}`;
    }

    logDiagnostics(channel: SwiftOutputChannel) {
        channel.logDiagnostic(`Swift Path: ${this.swiftFolderPath}`);
        channel.logDiagnostic(`Toolchain Path: ${this.toolchainPath}`);
        if (this.runtimePath) {
            channel.logDiagnostic(`Runtime Library Path: ${this.runtimePath}`);
        }
        if (this.defaultTarget) {
            channel.logDiagnostic(`Default Target: ${this.defaultTarget}`);
        }
        if (this.defaultSDK) {
            channel.logDiagnostic(`Default SDK: ${this.defaultSDK}`);
        }
        if (this.customSDK) {
            channel.logDiagnostic(`Custom SDK: ${this.customSDK}`);
        }
        if (this.xcTestPath) {
            channel.logDiagnostic(`XCTest Path: ${this.xcTestPath}`);
        }
    }

    private static async getSwiftFolderPath(): Promise<string> {
        try {
            let swift: string;
            if (configuration.path !== "") {
                swift = path.join(configuration.path, "swift");
            } else {
                switch (process.platform) {
                    case "darwin": {
                        const { stdout } = await execFile("which", ["swift"]);
                        swift = stdout.trimEnd();
                        break;
                    }
                    case "win32": {
                        const { stdout } = await execFile("where", ["swift"]);
                        swift = stdout.trimEnd();
                        break;
                    }
                    default: {
                        // use `type swift` to find `swift`. Run inside /bin/sh to ensure
                        // we get consistent output as different shells output a different
                        // format. Tried running with `-p` but that is not available in /bin/sh
                        const { stdout } = await execFile("/bin/sh", [
                            "-c",
                            "LCMESSAGES=C type swift",
                        ]);
                        const swiftMatch = /^swift is (.*)$/.exec(stdout.trimEnd());
                        if (swiftMatch) {
                            swift = swiftMatch[1];
                        } else {
                            throw Error("Failed to find swift executable");
                        }
                        break;
                    }
                }
            }
            // swift may be a symbolic link
            const realSwift = await fs.realpath(swift);
            const swiftPath = path.dirname(realSwift);
            return await this.getSwiftEnvPath(swiftPath);
        } catch {
            throw Error("Failed to find swift executable");
        }
    }

    /**
     * swiftenv is a popular way to install swift on Linux. It uses shim shell scripts
     * for all of the swift executables. This is problematic when we are trying to find
     * the lldb version. Also swiftenv can also change the swift version beneath which
     * could cause problems. This function will return the actual path to the swift
     * executable instead of the shim version
     * @param swiftPath Path to swift folder
     * @returns Path to swift folder installed by swiftenv
     */
    private static async getSwiftEnvPath(swiftPath: string): Promise<string> {
        if (process.platform === "linux" && swiftPath.endsWith(".swiftenv/shims")) {
            try {
                const swiftenvPath = path.dirname(swiftPath);
                const swiftenv = path.join(swiftenvPath, "libexec", "swiftenv");
                const { stdout } = await execFile(swiftenv, ["which", "swift"]);
                const swift = stdout.trimEnd();
                return path.dirname(swift);
            } catch {
                return swiftPath;
            }
        } else {
            return swiftPath;
        }
    }

    /**
     * @returns path to Toolchain folder
     */
    private static async getToolchainPath(swiftPath: string): Promise<string> {
        try {
            switch (process.platform) {
                case "darwin": {
                    if (configuration.path !== "") {
                        return path.dirname(path.dirname(configuration.path));
                    }
                    const { stdout } = await execFile("xcrun", ["--find", "swift"], {
                        env: configuration.swiftEnvironmentVariables,
                    });
                    const swift = stdout.trimEnd();
                    return path.dirname(path.dirname(path.dirname(swift)));
                }
                default: {
                    return path.dirname(path.dirname(swiftPath));
                }
            }
        } catch {
            throw Error("Failed to find swift toolchain");
        }
    }

    /**
     * @param targetInfo swift target info
     * @returns path to Swift runtime
     */
    private static async getRuntimePath(targetInfo: SwiftTargetInfo): Promise<string | undefined> {
        if (configuration.runtimePath !== "") {
            return configuration.runtimePath;
        } else if (process.platform === "win32") {
            const { stdout } = await execFile("where", ["swiftCore.dll"]);
            const swiftCore = stdout.trimEnd();
            return swiftCore.length > 0 ? path.dirname(swiftCore) : undefined;
        } else {
            return targetInfo.paths.runtimeLibraryPaths.length > 0
                ? targetInfo.paths.runtimeLibraryPaths.join(":")
                : undefined;
        }
    }

    /**
     * @returns path to default SDK
     */
    private static async getDefaultSDK(): Promise<string | undefined> {
        switch (process.platform) {
            case "darwin": {
                if (process.env.SDKROOT) {
                    return process.env.SDKROOT;
                }

                return this.getSDKPath("macosx");
            }
            case "win32": {
                return process.env.SDKROOT;
            }
        }
        return undefined;
    }

    /**
     * @returns path to custom SDK
     */
    private static getCustomSDK(): string | undefined {
        return configuration.sdk !== "" ? configuration.sdk : undefined;
    }

    /**
     * @param targetInfo swift target info
     * @param swiftVersion parsed swift version
     * @param runtimePath path to Swift runtime
     * @param sdkroot path to swift SDK
     * @returns path to folder where xctest can be found
     */
    private static async getXCTestPath(
        targetInfo: SwiftTargetInfo,
        swiftVersion: Version,
        runtimePath: string | undefined,
        sdkroot: string | undefined
    ): Promise<string | undefined> {
        switch (process.platform) {
            case "darwin": {
                const developerDir = await this.getXcodeDeveloperDir(
                    configuration.swiftEnvironmentVariables
                );
                return path.join(developerDir, "usr", "bin");
            }
            case "win32": {
                // look up runtime library directory for XCTest alternatively
                const fallbackPath =
                    runtimePath !== undefined &&
                    (await pathExists(path.join(runtimePath, "XCTest.dll")))
                        ? runtimePath
                        : undefined;
                if (!sdkroot) {
                    return fallbackPath;
                }
                const platformPath = path.dirname(path.dirname(path.dirname(sdkroot)));
                const platformManifest = path.join(platformPath, "Info.plist");
                if ((await pathExists(platformManifest)) !== true) {
                    if (fallbackPath) {
                        return fallbackPath;
                    }
                    vscode.window.showWarningMessage(
                        "XCTest not found due to non-standardized library layout. Tests explorer won't work as expected."
                    );
                    return undefined;
                }
                const data = await fs.readFile(platformManifest, "utf8");
                const infoPlist = plist.parse(data) as unknown as InfoPlist;
                const version = infoPlist.DefaultProperties.XCTEST_VERSION;
                if (!version) {
                    throw Error("Info.plist is missing the XCTEST_VERSION key.");
                }

                if (swiftVersion >= new Version(5, 7, 0)) {
                    let bindir: string;
                    const arch = targetInfo.target?.triple.split("-", 1)[0];
                    switch (arch) {
                        case "x86_64":
                            bindir = "bin64";
                            break;
                        case "i686":
                            bindir = "bin32";
                            break;
                        case "aarch64":
                            bindir = "bin64a";
                            break;
                        default:
                            throw Error(`unsupported architecture ${arch}`);
                    }
                    return path.join(
                        platformPath,
                        "Developer",
                        "Library",
                        `XCTest-${version}`,
                        "usr",
                        bindir
                    );
                } else {
                    return path.join(
                        platformPath,
                        "Developer",
                        "Library",
                        `XCTest-${version}`,
                        "usr",
                        "bin"
                    );
                }
            }
        }
        return undefined;
    }

    /** @returns swift target info */
    private static async getSwiftTargetInfo(): Promise<SwiftTargetInfo> {
        try {
            const { stdout } = await execSwift(["-print-target-info"]);
            const targetInfo = JSON.parse(stdout.trimEnd()) as SwiftTargetInfo;
            // workaround for Swift 5.3 and older toolchains
            if (targetInfo.compilerVersion === undefined) {
                const { stdout } = await execSwift(["--version"]);
                targetInfo.compilerVersion = stdout.split("\n", 1)[0];
            }
            return targetInfo;
        } catch {
            throw Error("Cannot parse swift target info output.");
        }
    }

    /**
     * @param targetInfo swift target info
     * @returns swift version object
     */
    private static getSwiftVersion(targetInfo: SwiftTargetInfo): Version {
        const match = targetInfo.compilerVersion.match(/Swift version ([\S]+)/);
        let version: Version | undefined;
        if (match) {
            version = Version.fromString(match[1]);
        }
        return version ?? new Version(0, 0, 0);
    }
}
