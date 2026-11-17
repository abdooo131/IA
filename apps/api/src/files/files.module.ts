import { Global, Inject, Module, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { useFileStore } from '@shiplynow/db';
import { FilesController } from './files.controller';
import { ConfiguredFileStore, FileStore } from './file-store';

/**
 * The file store boundary: R2 when configured, else the database. At start it is handed to
 * @shiplynow/db, whose upload and read helpers (storeFileBytes, readStoredFile) every file route
 * uses; tests replace it with FakeFileStore.
 */
@Global()
@Module({
  controllers: [FilesController],
  providers: [{ provide: FileStore, useClass: ConfiguredFileStore }],
  exports: [FileStore],
})
export class FilesModule implements OnModuleInit, OnModuleDestroy {
  constructor(@Inject(FileStore) private readonly store: FileStore) {}

  onModuleInit() {
    useFileStore(this.store);
  }

  onModuleDestroy() {
    useFileStore(null);
  }
}
