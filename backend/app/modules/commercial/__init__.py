"""Commercial bounded module composition root."""

from fastapi import APIRouter

from app.modules.commercial.api import router as foundation_router
from app.modules.commercial.order_management import router as order_management_router

router = APIRouter()
router.include_router(foundation_router)
router.include_router(order_management_router)

__all__ = ["router"]
