-- Служебное состояние фонового обслуживания (доставка заявок)
CREATE TABLE "service_state" (
    "key" TEXT NOT NULL,
    "value" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "service_state_pkey" PRIMARY KEY ("key")
);
