import { registerTab } from "../tabs";
import { Abstraction } from "./tabs/Abstraction";
import { Conversation } from "./tabs/Conversation";
import { InsuranceReview } from "./tabs/InsuranceReview";
import { LeaseTerms } from "./tabs/LeaseTerms";
import { Resident360 } from "./tabs/Resident360";

registerTab({ key: "residents.overview", label: "Overview", entity: "residents", component: Resident360 });
registerTab({ key: "residents.terms", label: "Terms and schedule", entity: "leases", component: LeaseTerms });
registerTab({ key: "residents.abstraction", label: "Abstraction", entity: "leases", roles: ["principal", "regional_manager", "property_manager", "broker", "accountant", "leasing_agent"], component: Abstraction });
registerTab({ key: "residents.conversation", label: "Conversation", entity: "message_threads", component: Conversation });
registerTab({ key: "residents.insurance_review", label: "Review", entity: "renters_insurance", component: InsuranceReview });
