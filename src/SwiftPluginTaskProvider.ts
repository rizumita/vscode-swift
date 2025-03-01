//===----------------------------------------------------------------------===//
//
// This source file is part of the VSCode Swift open source project
//
// Copyright (c) 2021-2022 the VSCode Swift project authors
// Licensed under Apache License v2.0
//
// See LICENSE.txt for license information
// See CONTRIBUTORS.txt for the list of VSCode Swift project authors
//
// SPDX-License-Identifier: Apache-2.0
//
//===----------------------------------------------------------------------===//

import * as vscode from "vscode";
import * as path from "path";
import { WorkspaceContext } from "./WorkspaceContext";
import { PackagePlugin } from "./SwiftPackage";
import configuration from "./configuration";
import { getSwiftExecutable, swiftRuntimeEnv, withSwiftSDKFlags } from "./utilities/utilities";

// Interface class for defining task configuration
interface TaskConfig {
    cwd: vscode.Uri;
    scope: vscode.WorkspaceFolder;
    presentationOptions?: vscode.TaskPresentationOptions;
    prefix?: string;
}

/**
 * A {@link vscode.TaskProvider TaskProvider} for tasks that match the definition
 * in **package.json**: `{ type: 'swift'; command: string; args: string[] }`.
 *
 * See {@link SwiftTaskProvider.provideTasks provideTasks} for a list of provided tasks.
 */
export class SwiftPluginTaskProvider implements vscode.TaskProvider {
    constructor(private workspaceContext: WorkspaceContext) {}

    /**
     * Provides tasks to run swift plugins:
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    async provideTasks(token: vscode.CancellationToken): Promise<vscode.Task[]> {
        if (this.workspaceContext.folders.length === 0) {
            return [];
        }
        const tasks = [];

        for (const folderContext of this.workspaceContext.folders) {
            for (const plugin of folderContext.swiftPackage.plugins) {
                tasks.push(
                    this.createSwiftPluginTask(plugin, [], {
                        cwd: folderContext.folder,
                        scope: folderContext.workspaceFolder,
                        presentationOptions: {
                            reveal: vscode.TaskRevealKind.Always,
                        },
                    })
                );
            }
        }
        return tasks;
    }

    /**
     * Resolves a {@link vscode.Task Task} specified in **tasks.json**.
     *
     * Other than its definition, this `Task` may be incomplete,
     * so this method should fill in the blanks.
     */
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    resolveTask(task: vscode.Task, token: vscode.CancellationToken): vscode.Task {
        // We need to create a new Task object here.
        // Reusing the task parameter doesn't seem to work.
        const swift = getSwiftExecutable();
        const sandboxArg = task.definition.disableSandbox ? ["--disable-sandbox"] : [];
        const writingToPackageArg = task.definition.allowWritingToPackageDirectory
            ? ["--allow-writing-to-package-directory"]
            : [];
        let swiftArgs = [
            "package",
            ...sandboxArg,
            ...writingToPackageArg,
            task.definition.command,
            ...task.definition.args,
        ];
        swiftArgs = withSwiftSDKFlags(swiftArgs);

        const newTask = new vscode.Task(
            task.definition,
            task.scope ?? vscode.TaskScope.Workspace,
            task.definition.command,
            "swift-plugin",
            new vscode.ProcessExecution(swift, swiftArgs, {
                cwd: task.definition.cwd,
            }),
            task.problemMatchers
        );
        newTask.detail = task.detail ?? `swift ${swiftArgs.join(" ")}`;
        newTask.presentationOptions = task.presentationOptions;

        return newTask;
    }

    /**
     *
     * @param plugin Helper function to create a swift plugin task
     * @param args arguments sent to plugin
     * @param config
     * @returns
     */
    createSwiftPluginTask(plugin: PackagePlugin, args: string[], config: TaskConfig): vscode.Task {
        const swift = getSwiftExecutable();
        let swiftArgs = ["package", plugin.command, ...args];
        swiftArgs = withSwiftSDKFlags(swiftArgs);

        // Add relative path current working directory
        const relativeCwd = path.relative(config.scope.uri.fsPath, config.cwd?.fsPath);
        const cwd = relativeCwd !== "" ? relativeCwd : undefined;

        const task = new vscode.Task(
            {
                type: "swift-plugin",
                command: plugin.command,
                args: args,
                disableSandbox: false,
                allowWritingToPackageDirectory: false,
                cwd: cwd,
            },
            config.scope ?? vscode.TaskScope.Workspace,
            plugin.name,
            "swift-plugin",
            new vscode.ProcessExecution(swift, swiftArgs, {
                cwd: cwd,
                env: { ...configuration.swiftEnvironmentVariables, ...swiftRuntimeEnv() },
            })
        );
        let prefix: string;
        if (config.prefix) {
            prefix = `(${config.prefix}) `;
        } else {
            prefix = "";
        }
        task.detail = `${prefix}swift ${swiftArgs.join(" ")}`;
        task.presentationOptions = config?.presentationOptions ?? {};
        return task;
    }
}
