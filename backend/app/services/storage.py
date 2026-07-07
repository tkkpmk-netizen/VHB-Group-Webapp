"""S3-compatible object storage abstraction."""

import asyncio
from functools import lru_cache
from typing import Protocol

import boto3  # type: ignore[import-untyped]
from botocore.config import Config  # type: ignore[import-untyped]
from botocore.exceptions import ClientError  # type: ignore[import-untyped]

from app.core.config import get_settings


class StoredObjectNotFoundError(Exception):
    """Raised when an object key does not exist."""


class ObjectStorage(Protocol):
    async def presign_upload(self, key: str, *, content_type: str, expires_seconds: int) -> str: ...

    async def presign_download(self, key: str, *, filename: str, expires_seconds: int) -> str: ...

    async def object_size(self, key: str) -> int: ...

    async def delete(self, key: str) -> None: ...
    async def get_bytes(self, key: str) -> bytes: ...
    async def put_bytes(self, key: str, data: bytes, *, content_type: str) -> None: ...


class S3ObjectStorage:
    def __init__(self) -> None:
        settings = get_settings()
        client_options = {
            "aws_access_key_id": settings.storage_access_key,
            "aws_secret_access_key": settings.storage_secret_key,
            "region_name": settings.storage_region,
            "config": Config(signature_version="s3v4"),
        }
        self.bucket = settings.storage_bucket
        self._client = boto3.client(
            "s3", endpoint_url=settings.storage_endpoint_url, **client_options
        )
        self._public_client = boto3.client(
            "s3",
            endpoint_url=settings.storage_public_endpoint_url,
            **client_options,
        )
        self._bucket_ready = False

    def _ensure_bucket_sync(self) -> None:
        if self._bucket_ready:
            return
        try:
            self._client.head_bucket(Bucket=self.bucket)
        except ClientError:
            self._client.create_bucket(Bucket=self.bucket)
        self._bucket_ready = True

    async def _ensure_bucket(self) -> None:
        await asyncio.to_thread(self._ensure_bucket_sync)

    async def presign_upload(self, key: str, *, content_type: str, expires_seconds: int) -> str:
        await self._ensure_bucket()
        return await asyncio.to_thread(
            self._public_client.generate_presigned_url,
            "put_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ContentType": content_type,
            },
            ExpiresIn=expires_seconds,
        )

    async def presign_download(self, key: str, *, filename: str, expires_seconds: int) -> str:
        await self._ensure_bucket()
        return await asyncio.to_thread(
            self._public_client.generate_presigned_url,
            "get_object",
            Params={
                "Bucket": self.bucket,
                "Key": key,
                "ResponseContentDisposition": f'attachment; filename="{filename}"',
            },
            ExpiresIn=expires_seconds,
        )

    async def object_size(self, key: str) -> int:
        await self._ensure_bucket()
        try:
            response = await asyncio.to_thread(
                self._client.head_object, Bucket=self.bucket, Key=key
            )
        except ClientError as exc:
            raise StoredObjectNotFoundError(key) from exc
        return int(response["ContentLength"])

    async def delete(self, key: str) -> None:
        await self._ensure_bucket()
        await asyncio.to_thread(self._client.delete_object, Bucket=self.bucket, Key=key)

    async def get_bytes(self, key: str) -> bytes:
        await self._ensure_bucket()
        try:
            response = await asyncio.to_thread(self._client.get_object, Bucket=self.bucket, Key=key)
        except ClientError as exc:
            raise StoredObjectNotFoundError(key) from exc
        return await asyncio.to_thread(response["Body"].read)

    async def put_bytes(self, key: str, data: bytes, *, content_type: str) -> None:
        await self._ensure_bucket()
        await asyncio.to_thread(
            self._client.put_object,
            Bucket=self.bucket,
            Key=key,
            Body=data,
            ContentType=content_type,
        )


@lru_cache
def get_object_storage() -> ObjectStorage:
    return S3ObjectStorage()
