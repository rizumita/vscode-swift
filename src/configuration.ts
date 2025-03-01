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

import * as vscode from "vscode";

type CFamilySupportOptions = "enable" | "disable" | "cpptools-inactive";

/** sourcekit-lsp configuration */
export interface LSPConfiguration {
    /** Path to sourcekit-lsp executable */
    readonly serverPath: string;
    /** Arguments to pass to sourcekit-lsp executable */
    readonly serverArguments: string[];
    /** Are inlay hints enabled */
    readonly inlayHintsEnabled: boolean;
    /** Support C Family source files */
    readonly supportCFamily: CFamilySupportOptions;
    /** Is SourceKit-LSP disabled */
    readonly disable: boolean;
}

/** workspace folder configuration */
export interface FolderConfiguration {
    /** Environment variables to set when running tests */
    readonly testEnvironmentVariables: { [key: string]: string };
    /** auto-generate launch.json configurations */
    readonly autoGenerateLaunchConfigurations: boolean;
    /** disable automatic running of swift package resolve */
    readonly disableAutoResolve: boolean;
}

/**
 * Type-safe wrapper around configuration settings.
 */
const configuration = {
    /** sourcekit-lsp configuration */
    get lsp(): LSPConfiguration {
        return {
            get serverPath(): string {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<string>("serverPath", "");
            },
            get serverArguments(): string[] {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<string[]>("serverArguments", []);
            },
            get inlayHintsEnabled(): boolean {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<boolean>("inlayHints.enabled", true);
            },
            get supportCFamily(): CFamilySupportOptions {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<CFamilySupportOptions>("support-c-cpp", "cpptools-inactive");
            },
            get disable(): boolean {
                return vscode.workspace
                    .getConfiguration("sourcekit-lsp")
                    .get<boolean>("disable", false);
            },
        };
    },

    folder(workspaceFolder: vscode.WorkspaceFolder): FolderConfiguration {
        return {
            /** Environment variables to set when running tests */
            get testEnvironmentVariables(): { [key: string]: string } {
                return vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<{ [key: string]: string }>("testEnvironmentVariables", {});
            },
            /** auto-generate launch.json configurations */
            get autoGenerateLaunchConfigurations(): boolean {
                return vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<boolean>("autoGenerateLaunchConfigurations", true);
            },
            /** disable automatic running of swift package resolve */
            get disableAutoResolve(): boolean {
                return vscode.workspace
                    .getConfiguration("swift", workspaceFolder)
                    .get<boolean>("disableAutoResolve", false);
            },
        };
    },

    /** Files and directories to exclude from the Package Dependencies view. */
    get excludePathsFromPackageDependencies(): string[] {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string[]>("excludePathsFromPackageDependencies", []);
    },
    /** Path to folder that include swift executable */
    get path(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("path", "");
    },
    /** Path to folder that include swift runtime */
    get runtimePath(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("runtimePath", "");
    },
    /** Path to custom swift sdk */
    get sdk(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("SDK", "");
    },
    set sdk(value: string | undefined) {
        vscode.workspace.getConfiguration("swift").update("SDK", value);
    },
    /** swift build arguments */
    get buildArguments(): string[] {
        return vscode.workspace.getConfiguration("swift").get<string[]>("buildArguments", []);
    },
    get buildPath(): string {
        return vscode.workspace.getConfiguration("swift").get<string>("buildPath", "");
    },
    /** Environment variables to set when building */
    get swiftEnvironmentVariables(): { [key: string]: string } {
        return vscode.workspace
            .getConfiguration("swift")
            .get<{ [key: string]: string }>("swiftEnvironmentVariables", {});
    },
    set swiftEnvironmentVariables(vars: { [key: string]: string }) {
        vscode.workspace.getConfiguration("swift").update("swiftEnvironmentVariables", vars);
    },
    /** include build errors in problems view */
    get problemMatchCompileErrors(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("problemMatchCompileErrors", true);
    },
    /** background compilation */
    get backgroundCompilation(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("backgroundCompilation", false);
    },
    /** output additional diagnostics */
    get diagnostics(): boolean {
        return vscode.workspace.getConfiguration("swift").get<boolean>("diagnostics", false);
    },
    /**
     *  Test coverage settings
     */
    /** Should test coverage report be displayed after running test coverage */
    get displayCoverageReportAfterRun(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("coverage.displayReportAfterRun", true);
    },
    get alwaysShowCoverageStatusItem(): boolean {
        return vscode.workspace
            .getConfiguration("swift")
            .get<boolean>("coverage.alwaysShowStatusItem", true);
    },
    get coverageHitColorLightMode(): string {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string>("coverage.colors.lightMode.hit", "#c0ffc0");
    },
    get coverageMissColorLightMode(): string {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string>("coverage.colors.lightMode.miss", "#ffc0c0");
    },
    get coverageHitColorDarkMode(): string {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string>("coverage.colors.darkMode.hit", "#003000");
    },
    get coverageMissColorDarkMode(): string {
        return vscode.workspace
            .getConfiguration("swift")
            .get<string>("coverage.colors.darkMode.miss", "#400000");
    },
};

export default configuration;
