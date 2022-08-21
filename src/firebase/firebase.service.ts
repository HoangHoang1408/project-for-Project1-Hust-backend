import {
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';

import { FirebaseApp, initializeApp } from 'firebase/app';
import {
  deleteObject,
  FirebaseStorage,
  getDownloadURL,
  getStorage,
  ref,
  uploadBytes,
  UploadMetadata,
} from 'firebase/storage';
import * as sharp from 'sharp';
import { FIREBASE_CONFIG_OPTIONS } from 'src/common/constants/constants';
import { v1 } from 'uuid';
import { FirebaseConfigOption } from './constants/constants';

@Injectable()
export class FirebaseService {
  private readonly firebaseApp: FirebaseApp;
  private readonly storage: FirebaseStorage;
  constructor(
    @Inject(FIREBASE_CONFIG_OPTIONS) configOption: FirebaseConfigOption,
  ) {
    this.firebaseApp = initializeApp(configOption);
    this.storage = getStorage(this.firebaseApp);
  }
  async uploadFile(file: Express.Multer.File, storagePath: string) {
    try {
      const storageName = `${v1()}.webp`;
      const metatdata: UploadMetadata = {
        contentType: 'image/webp',
      };
      const buffer = await sharp(file.buffer)
        .webp({
          quality: 60,
        })
        .toBuffer();
      const storageRef = ref(this.storage, `${storagePath}/${storageName}`);
      const result = await uploadBytes(storageRef, buffer, metatdata);
      const fileUrl = await getDownloadURL(result.ref);
      return {
        fileReference: {
          fileUrl,
          filePath: result.ref.fullPath,
        },
      };
    } catch (error) {
      console.log(error);
      throw new ServiceUnavailableException(
        'Can not upload file. Please try again later',
      );
    }
  }
  async uploadFiles(files: Express.Multer.File[], storagePath) {
    try {
      const results = await Promise.all(
        files.map((file) => this.uploadFile(file, storagePath)),
      );
      const fileReferences = results.map(
        ({ fileReference: { filePath, fileUrl } }) => ({ fileUrl, filePath }),
      );
      return {
        fileReferences,
      };
    } catch {
      throw new ServiceUnavailableException(
        'Can not upload file. Please try again later',
      );
    }
  }
  async deleteFile(storagePathName: string) {
    try {
      const storageRef = ref(this.storage, storagePathName);
      await deleteObject(storageRef);
    } catch {
      throw new ServiceUnavailableException(
        'Can not delete file. Please try again later',
      );
    }
  }
}
