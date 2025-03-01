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
import * as path from "path";
import { LinuxMain } from "./LinuxMain";
import { PackageWatcher } from "./PackageWatcher";
import { SwiftPackage } from "./SwiftPackage";
import { TestExplorer } from "./TestExplorer/TestExplorer";
import { WorkspaceContext, FolderEvent } from "./WorkspaceContext";
import { BackgroundCompilation } from "./BackgroundCompilation";
import { TaskQueue } from "./TaskQueue";
import { LcovResults } from "./coverage/LcovResults";

export class FolderContext implements vscode.Disposable {
    private packageWatcher: PackageWatcher;
    public backgroundCompilation: BackgroundCompilation;
    public hasResolveErrors = false;
    public testExplorer?: TestExplorer;
    public taskQueue: TaskQueue;
    public lcovResults: LcovResults;

    /**
     * FolderContext constructor
     * @param folder Workspace Folder
     * @param swiftPackage Swift Package inside the folder
     * @param workspaceContext Workspace context
     */
    private constructor(
        public folder: vscode.Uri,
        public linuxMain: LinuxMain,
        public swiftPackage: SwiftPackage,
        public workspaceFolder: vscode.WorkspaceFolder,
        public workspaceContext: WorkspaceContext
    ) {
        this.packageWatcher = new PackageWatcher(this, workspaceContext);
        this.packageWatcher.install();
        this.backgroundCompilation = new BackgroundCompilation(this);
        this.taskQueue = new TaskQueue(this);
        this.lcovResults = new LcovResults(this);
    }

    /** dispose of any thing FolderContext holds */
    dispose() {
        this.linuxMain?.dispose();
        this.packageWatcher.dispose();
        this.testExplorer?.dispose();
        this.lcovResults.dispose();
    }

    /**
     * Create FolderContext
     * @param folder Folder that Folder Context is being created for
     * @param workspaceContext Workspace context for extension
     * @returns a new FolderContext
     */
    static async create(
        folder: vscode.Uri,
        workspaceFolder: vscode.WorkspaceFolder,
        workspaceContext: WorkspaceContext
    ): Promise<FolderContext> {
        const statusItemText = `Loading Package (${FolderContext.uriName(folder)})`;
        workspaceContext.statusItem.start(statusItemText);

        const { linuxMain, swiftPackage } =
            await workspaceContext.statusItem.showStatusWhileRunning(statusItemText, async () => {
                const linuxMain = await LinuxMain.create(folder);
                const swiftPackage = await SwiftPackage.create(folder);
                return { linuxMain, swiftPackage };
            });

        workspaceContext.statusItem.end(statusItemText);

        const folderContext = new FolderContext(
            folder,
            linuxMain,
            swiftPackage,
            workspaceFolder,
            workspaceContext
        );

        const error = swiftPackage.error;
        if (error) {
            vscode.window.showErrorMessage(
                `Failed to load ${folderContext.name}/Package.swift: ${error.message}`
            );
            workspaceContext.outputChannel.log(
                `Failed to load Package.swift: ${error.message}`,
                folderContext.name
            );
        }

        return folderContext;
    }

    get name(): string {
        const relativePath = this.relativePath;
        if (relativePath.length === 0) {
            return this.workspaceFolder.name;
        } else {
            return `${this.workspaceFolder.name}/${this.relativePath}`;
        }
    }

    get relativePath(): string {
        return path.relative(this.workspaceFolder.uri.fsPath, this.folder.fsPath);
    }

    get isRootFolder(): boolean {
        return this.workspaceFolder.uri === this.folder;
    }

    /** reload swift package for this folder */
    async reload() {
        await this.swiftPackage.reload();
    }

    /** reload Package.resolved for this folder */
    async reloadPackageResolved() {
        await this.swiftPackage.reloadPackageResolved();
    }

    /** Load Swift Plugins and store in Package */
    async loadSwiftPlugins() {
        const plugins = await SwiftPackage.loadPlugins(this.workspaceFolder.uri);
        this.swiftPackage.plugins = plugins;
    }

    /**
     * Fire an event to all folder observers
     * @param event event type
     */
    async fireEvent(event: FolderEvent) {
        this.workspaceContext.fireEvent(this, event);
    }

    /** Return edited Packages folder */
    editedPackageFolder(identifier: string) {
        return path.join(this.folder.fsPath, "Packages", identifier);
    }

    /** Create Test explorer for this folder */
    addTestExplorer() {
        this.testExplorer = new TestExplorer(this);
    }

    static uriName(uri: vscode.Uri): string {
        return path.basename(uri.fsPath);
    }
}

export interface EditedPackage {
    name: string;
    folder: string;
}
