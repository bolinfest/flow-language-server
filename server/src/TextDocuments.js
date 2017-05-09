// @flow

import type {
  IConnection,
  TextDocumentSyncKindType,
} from 'vscode-languageserver';

import type {
  DidChangeTextDocumentParams,
  DidCloseTextDocumentParams,
  DidOpenTextDocumentParams,
  DidSaveTextDocumentParams,
} from 'vscode-languageserver/lib/protocol';

import type {NuclideUri} from './pkg/commons-node/nuclideUri';
import type {TextDocumentItem} from 'vscode-languageserver-types';

import invariant from 'assert';
import TextDocument from './TextDocument';
import UniversalDisposable from './pkg/commons-node/UniversalDisposable';
import {Emitter} from 'event-kit';
import {TextDocumentSyncKind} from 'vscode-languageserver';
import {getLogger} from './pkg/nuclide-logging';

const logger = getLogger();

function textDocumentFromLSPTextDocument(textDocument: TextDocumentItem) {
  return new TextDocument(
    textDocument.uri,
    textDocument.languageId,
    textDocument.version,
    textDocument.text,
  );
}

export default class TextDocuments {
  _disposables = new UniversalDisposable();
  _documents: Map<string, TextDocument> = new Map();
  _emitter: Emitter = new Emitter();

  constructor() {
    this._disposables.add(this._emitter);
  }

  dispose(): void {
    this._disposables.dispose();
  }

  get disposed(): boolean {
    return this._disposables.disposed;
  }

  get syncKind(): TextDocumentSyncKindType {
    return TextDocumentSyncKind.Incremental;
  }

  get(uri: string): TextDocument {
    const document = this._documents.get(uri);

    invariant(
      document != null,
      `TextDocuments: asked for document with uri ${uri}, but no buffer was loaded`,
    );
    return document;
  }

  listen(connection: IConnection): void {
    connection.onDidOpenTextDocument((e: DidOpenTextDocumentParams) => {
      const {textDocument} = e;
      const document = textDocumentFromLSPTextDocument(textDocument);
      this.addDocument(textDocument.uri, document);
    });

    connection.onDidChangeTextDocument((e: DidChangeTextDocumentParams) => {
      const {contentChanges, textDocument} = e;
      const document = this.get(textDocument.uri);
      document.updateMany(contentChanges, textDocument.version);
    });

    connection.onDidCloseTextDocument((e: DidCloseTextDocumentParams) => {
      this.removeDocument(e.textDocument.uri);
    });

    connection.onDidSaveTextDocument((e: DidSaveTextDocumentParams) => {
      const document = this.get(e.textDocument.uri);
      document.save(e.textDocument.version, e.text);
    });
  }

  addDocument(uri: NuclideUri, document: TextDocument) {
    logger.debug(`TextDocuments: adding document ${uri}`);
    this._documents.set(uri, document);
    this._disposables.add(document);
    this._emitter.emit('didOpenTextDocument', {textDocument: document});
    document.onDidStopChanging(this._handleDidStopChanging);
    document.onDidSave(this._handleDidSave);
  }

  removeDocument(uri: NuclideUri) {
    logger.debug(`TextDocuments: removing document ${uri}`);
    const document = this.get(uri);
    this._disposables.remove(document);
    this._documents.delete(uri);
    document.dispose();
  }

  all(): Array<TextDocument> {
    return Array.from(this._documents.values());
  }

  onDidChangeContent(handler: (e: TextDocumentChangeEvent) => void): void {
    this._emitter.on('didChangeContent', handler);
  }

  onDidSave(handler: (e: TextDocumentChangeEvent) => void): void {
    this._emitter.on('didSave', handler);
  }

  onDidOpenTextDocument(handler: (e: TextDocumentChangeEvent) => void): void {
    this._emitter.on('didOpenTextDocument', handler);
  }

  _handleDidStopChanging = (document: TextDocument) => {
    this._emitter.emit('didChangeContent', {document});
  };

  _handleDidSave = (document: TextDocument) => {
    this._emitter.emit('didSave', {document});
  };
}
