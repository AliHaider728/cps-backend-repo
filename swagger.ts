import swaggerJsdoc from 'swagger-jsdoc';

const options = {
  definition: {
    openapi: '3.0.0',
    info: {
      title: 'CPS Intranet API',
      version: '1.0.0',
      description: 'API documentation for CPS Intranet backend',
    },
    servers: [
      {
        url: 'https://cps-backend-ten.vercel.app',
        description: 'Production server',
      },
      {
        url: 'http://localhost:5000',
        description: 'Local server',
      },
    ],
    components: {
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
        },
      },
      schemas: {
        // ─────────────────────────────────────────────────────────
        // SHIFT
        // ─────────────────────────────────────────────────────────
        Shift: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            surgeryId: { type: 'string', format: 'uuid' },
            clientId: { type: 'string' },
            shiftDate: { type: 'string', format: 'date' },
            dayOfWeek: { type: 'string' },
            shiftType: {
              type: 'string',
              enum: ['working', 'annual_leave', 'sick', 'cppe_training', 'cover', 'bank_holiday'],
            },
            status: {
              type: 'string',
              enum: ['working', 'annual_leave', 'sick', 'cppe', 'cover', 'gap', 'cancelled'],
            },
            startTime: { type: 'string', format: 'time' },
            endTime: { type: 'string', format: 'time' },
            expectedHours: { type: 'number', format: 'float' },
            hours: { type: 'number', format: 'float' },
            hourlyRate: { type: 'number', format: 'float' },
            totalValue: { type: 'number', format: 'float' },
            clinicalSystem: { type: 'string' },
            isFilled: { type: 'boolean' },
            isCover: { type: 'boolean' },
            coverFor: { type: 'string', format: 'uuid' },
            coverReason: { type: 'string' },
            projectCode: { type: 'string' },
            serviceCode: { type: 'string' },
            originalGapId: { type: 'string', format: 'uuid' },
            confirmationReceived: { type: 'boolean' },
            accessRequestNeeded: { type: 'boolean' },
            clientInformed: { type: 'boolean' },
            clinicianNotified: { type: 'boolean' },
            workstreamsNotes: { type: 'string' },
            hoursToCover: { type: 'number', format: 'float' },
            hoursCovered: { type: 'number', format: 'float' },
            complianceChecked: { type: 'boolean' },
            complianceOverrideBy: { type: 'string' },
            complianceOverrideReason: { type: 'string' },
            source: { type: 'string', enum: ['manual', 'pattern', 'generated'] },
            sourceLeaveId: { type: 'string', format: 'uuid' },
            rotaMonth: { type: 'integer' },
            rotaYear: { type: 'integer' },
            sentToClient: { type: 'boolean' },
            createdBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        ShiftInput: {
          type: 'object',
          required: ['clinicianId', 'shiftDate'],
          properties: {
            clinicianId: { type: 'string', format: 'uuid' },
            surgeryId: { type: 'string', format: 'uuid' },
            clientId: { type: 'string' },
            shiftDate: { type: 'string', format: 'date' },
            shiftType: {
              type: 'string',
              enum: ['working', 'annual_leave', 'sick', 'cppe_training', 'cover', 'bank_holiday'],
            },
            startTime: { type: 'string', format: 'time' },
            endTime: { type: 'string', format: 'time' },
            expectedHours: { type: 'number', format: 'float' },
            isCover: { type: 'boolean' },
            coverFor: { type: 'string', format: 'uuid' },
            notes: { type: 'string' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // ROTA GAP
        // ─────────────────────────────────────────────────────────
        RotaGap: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            shiftDate: { type: 'string', format: 'date' },
            surgeryId: { type: 'string', format: 'uuid' },
            clientId: { type: 'string' },
            clientName: { type: 'string' },
            shiftType: { type: 'string' },
            startTime: { type: 'string', format: 'time' },
            endTime: { type: 'string', format: 'time' },
            expectedHours: { type: 'number', format: 'float' },
            priority: {
              type: 'string',
              enum: ['urgent', 'high', 'medium', 'low'],
            },
            isFilled: { type: 'boolean' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // COVER REQUEST
        // ─────────────────────────────────────────────────────────
        CoverRequest: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            shiftId: { type: 'string', format: 'uuid' },
            rotaShiftId: { type: 'string', format: 'uuid' },
            practiceId: { type: 'string' },
            surgeryId: { type: 'string', format: 'uuid' },
            practiceName: { type: 'string' },
            clientId: { type: 'string', format: 'uuid' },
            shiftDate: { type: 'string', format: 'date' },
            date: { type: 'string', format: 'date' },
            shiftStart: { type: 'string', format: 'time' },
            shiftEnd: { type: 'string', format: 'time' },
            startTime: { type: 'string', format: 'time' },
            endTime: { type: 'string', format: 'time' },
            shiftType: {
              type: 'string',
              enum: ['full_day', 'morning', 'afternoon', 'evening', 'night', 'custom'],
            },
            reason: {
              type: 'string',
              enum: ['leave', 'absence', 'sick', 'vacancy', 'other'],
            },
            description: { type: 'string' },
            specialRequirements: {
              type: 'array',
              items: { type: 'string' },
            },
            numberOfClinicians: { type: 'integer' },
            hoursNeeded: { type: 'number', format: 'float' },
            requiredSkills: {
              type: 'array',
              items: { type: 'string' },
            },
            clinicalSystem: { type: 'string' },
            serviceCode: {
              type: 'string',
              enum: ['PCN', 'GP', 'EA'],
            },
            projectCode: { type: 'string' },
            status: {
              type: 'string',
              enum: [
                'open',
                'pending_assignment',
                'assigned',
                'filled',
                'cancelled',
                'completed',
                'on_hold',
              ],
            },
            priority: {
              type: 'string',
              enum: ['low', 'medium', 'high', 'urgent'],
            },
            filledBy: { type: 'string' },
            assignedTo: { type: 'string', format: 'uuid' },
            assignedBy: { type: 'string', format: 'uuid' },
            assignedAt: { type: 'string', format: 'date-time' },
            confirmationRequired: { type: 'boolean' },
            payGrade: { type: 'string' },
            hoursCovered: { type: 'number', format: 'float' },
            feedback: { type: 'string' },
            notes: { type: 'string' },
            emailSentAt: { type: 'string', format: 'date-time' },
            createdBy: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // TIMESHEET
        // ─────────────────────────────────────────────────────────
        Timesheet: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            month: { type: 'integer', minimum: 1, maximum: 12 },
            year: { type: 'integer' },
            status: {
              type: 'string',
              enum: ['draft', 'submitted', 'approved', 'rejected'],
            },
            submittedAt: { type: 'string', format: 'date-time' },
            approvedAt: { type: 'string', format: 'date-time' },
            approvedBy: { type: 'string', format: 'uuid' },
            rejectedAt: { type: 'string', format: 'date-time' },
            rejectedBy: { type: 'string', format: 'uuid' },
            rejectionReason: { type: 'string' },
            totalHours: { type: 'number', format: 'float' },
            invoiceSent: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        TimesheetEntry: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            timesheetId: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            surgeryId: { type: 'string', format: 'uuid' },
            shiftDate: { type: 'string', format: 'date' },
            startTime: { type: 'string', format: 'time' },
            endTime: { type: 'string', format: 'time' },
            actualHours: { type: 'number', format: 'float' },
            expectedHours: { type: 'number', format: 'float' },
            isCover: { type: 'boolean' },
            projectCode: { type: 'string' },
            serviceCode: {
              type: 'string',
              enum: ['PCN', 'GP', 'EA'],
            },
            notes: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        TimesheetDetail: {
          type: 'object',
          allOf: [
            { $ref: '#/components/schemas/Timesheet' },
            {
              type: 'object',
              properties: {
                entries: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/TimesheetEntry' },
                },
              },
            },
          ],
        },

        // ─────────────────────────────────────────────────────────
        // HOURS ENTRY (enterMyHoursRoutes)
        // ─────────────────────────────────────────────────────────
        HoursEntry: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            period: { type: 'string', format: 'date' },
            status: {
              type: 'string',
              enum: ['draft', 'submitted', 'approved', 'rejected'],
            },
            entries: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  date: { type: 'string', format: 'date' },
                  projectId: { type: 'string', format: 'uuid' },
                  hours: { type: 'number', format: 'float' },
                  notes: { type: 'string' },
                  tags: {
                    type: 'array',
                    items: { type: 'string' },
                  },
                },
              },
            },
            submittedAt: { type: 'string', format: 'date-time' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        HoursEntryForReview: {
          type: 'object',
          allOf: [
            { $ref: '#/components/schemas/HoursEntry' },
            {
              type: 'object',
              properties: {
                clinicianName: { type: 'string' },
                clinicianEmail: { type: 'string' },
                reviewedBy: { type: 'string', format: 'uuid' },
                reviewedAt: { type: 'string', format: 'date-time' },
                feedback: { type: 'string' },
              },
            },
          ],
        },

        // ─────────────────────────────────────────────────────────
        // RESTRICTION RECORD (restrictedClinicianRoutes)
        // ─────────────────────────────────────────────────────────
        RestrictionRecord: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            clinicianName: { type: 'string' },
            clientId: { type: 'string', format: 'uuid' },
            clientName: { type: 'string' },
            restrictionType: {
              type: 'string',
              enum: ['temporary', 'permanent', 'compliance', 'disciplinary'],
            },
            reason: { type: 'string' },
            startDate: { type: 'string', format: 'date-time' },
            endDate: { type: 'string', format: 'date-time' },
            isActive: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // CLIENT (clientRoutes)
        // ─────────────────────────────────────────────────────────
        Client: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            type: {
              type: 'string',
              enum: ['icb', 'federation', 'pcn', 'practice', 'ea'],
            },
            clinicalSystem: { type: 'string' },
            pcnId: { type: 'string', format: 'uuid' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // CLINICIAN (clinicianRoutes)
        // ─────────────────────────────────────────────────────────
        Clinician: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            firstName: { type: 'string' },
            lastName: { type: 'string' },
            fullName: { type: 'string' },
            email: { type: 'string', format: 'email' },
            phone: { type: 'string' },
            role: {
              type: 'string',
              enum: ['clinician', 'senior_clinician', 'team_lead'],
            },
            department: { type: 'string' },
            qualifications: {
              type: 'array',
              items: { type: 'string' },
            },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'on_leave'],
            },
            clinicianType: { type: 'string' },
            contractType: {
              type: 'string',
              enum: ['ARRS', 'EA', 'Direct'],
            },
            userId: { type: 'string', format: 'uuid' },
            smartcard: { type: 'string' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            opsLeadId: { type: 'string' },
            supervisorId: { type: 'string' },
            isRestricted: { type: 'boolean' },
            restrictionReason: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        ClinicianDetail: {
          type: 'object',
          allOf: [
            { $ref: '#/components/schemas/Clinician' },
            {
              type: 'object',
              properties: {
                leaveBalances: {
                  type: 'array',
                  items: { type: 'object' },
                },
                complianceGroups: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ComplianceGroup' },
                },
                projectMappings: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ProjectMapping' },
                },
                cppe: { $ref: '#/components/schemas/CPPE' },
              },
            },
          ],
        },

        // ─────────────────────────────────────────────────────────
        // LEAVE RECORD
        // ─────────────────────────────────────────────────────────
        LeaveRecord: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            type: {
              type: 'string',
              enum: ['annual', 'sick', 'unpaid', 'sabbatical'],
            },
            status: {
              type: 'string',
              enum: ['pending', 'approved', 'rejected'],
            },
            reason: { type: 'string' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // CLIENT HISTORY (clinician ↔ client interactions)
        // ─────────────────────────────────────────────────────────
        ClientHistory: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            clientName: { type: 'string' },
            date: { type: 'string', format: 'date-time' },
            type: {
              type: 'string',
              enum: ['consultation', 'follow_up', 'assessment'],
            },
            notes: { type: 'string' },
            outcome: { type: 'string' },
            accessLevel: {
              type: 'string',
              enum: ['none', 'read', 'write', 'admin'],
            },
            enabled: { type: 'boolean' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // PROJECT MAPPING
        // ─────────────────────────────────────────────────────────
        ProjectMapping: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            projectId: { type: 'string', format: 'uuid' },
            project: { type: 'string' },
            practiceId: { type: 'string' },
            type: {
              type: 'string',
              enum: ['Locums Contractor', 'Employed', 'Limited Company'],
            },
            allocationPercentage: { type: 'number', minimum: 0, maximum: 100 },
            billableRate: { type: 'number' },
            rate: { type: 'number' },
            rateType: {
              type: 'string',
              enum: ['Per Hour', 'Fixed'],
            },
            vatPercentage: { type: 'number' },
            startDate: { type: 'string', format: 'date' },
            endDate: { type: 'string', format: 'date' },
            status: {
              type: 'string',
              enum: ['active', 'inactive', 'archived'],
            },
            createdAt: { type: 'string', format: 'date-time' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // SUPERVISION LOG
        // ─────────────────────────────────────────────────────────
        SupervisionLog: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            date: { type: 'string', format: 'date-time' },
            supervisor: { type: 'string' },
            duration: {
              type: 'integer',
              description: 'Duration in minutes',
            },
            notes: { type: 'string' },
            topics: {
              type: 'array',
              items: { type: 'string' },
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // CPPE
        // ─────────────────────────────────────────────────────────
        CPPE: {
          type: 'object',
          properties: {
            clinicianId: { type: 'string', format: 'uuid' },
            hoursCompleted: { type: 'integer' },
            targetHours: { type: 'integer' },
            courses: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string' },
                  provider: { type: 'string' },
                  hoursEarned: { type: 'integer' },
                  completionDate: { type: 'string', format: 'date' },
                },
              },
            },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // COMPLIANCE DOC (clinician-level instance)
        // ─────────────────────────────────────────────────────────
        ComplianceDoc: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            clinicianId: { type: 'string', format: 'uuid' },
            documentId: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            category: { type: 'string' },
            status: {
              type: 'string',
              enum: ['pending', 'approved', 'rejected'],
            },
            fileUrl: { type: 'string' },
            notes: { type: 'string' },
            approvedNotes: { type: 'string' },
            rejectionReason: { type: 'string' },
            feedback: { type: 'string' },
            uploadedAt: { type: 'string', format: 'date-time' },
            approvedAt: { type: 'string', format: 'date-time' },
            approvedBy: { type: 'string', format: 'uuid' },
            expiryDate: { type: 'string', format: 'date' },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        // ─────────────────────────────────────────────────────────
        // COMPLIANCE GROUP (assignment of compliance docs to entities)
        // ─────────────────────────────────────────────────────────
        ComplianceGroup: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            name: { type: 'string' },
            description: { type: 'string' },
            entityType: {
              type: 'string',
              enum: ['Clinician', 'PCN', 'Practice'],
            },
            documentIds: {
              type: 'array',
              items: { type: 'string', format: 'uuid' },
            },
            memberCount: { type: 'integer' },
            status: {
              type: 'string',
              enum: ['active', 'archived'],
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        ComplianceGroupDetail: {
          type: 'object',
          allOf: [
            { $ref: '#/components/schemas/ComplianceGroup' },
            {
              type: 'object',
              properties: {
                documents: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ComplianceDocument' },
                },
                members: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', format: 'uuid' },
                      name: { type: 'string' },
                    },
                  },
                },
              },
            },
          ],
        },

        // ─────────────────────────────────────────────────────────
        // COMPLIANCE DOCUMENT (template, complianceDocRoutes)
        // ─────────────────────────────────────────────────────────
        ComplianceDocument: {
          type: 'object',
          properties: {
            id: { type: 'string', format: 'uuid' },
            title: { type: 'string' },
            category: { type: 'string' },
            description: { type: 'string' },
            renewalFrequency: {
              type: 'string',
              enum: ['annual', 'biennial', 'triennial', 'on_demand'],
            },
            expiryDays: { type: 'integer' },
            status: {
              type: 'string',
              enum: ['active', 'archived'],
            },
            createdAt: { type: 'string', format: 'date-time' },
            updatedAt: { type: 'string', format: 'date-time' },
          },
        },

        ComplianceDocumentDetail: {
          type: 'object',
          allOf: [
            { $ref: '#/components/schemas/ComplianceDocument' },
            {
              type: 'object',
              properties: {
                groups: {
                  type: 'array',
                  items: { $ref: '#/components/schemas/ComplianceGroup' },
                },
              },
            },
          ],
        },
      },
    },
    security: [{ bearerAuth: [] }],
  },
  apis: ['./routes/*.ts'],
};

const swaggerSpec = swaggerJsdoc(options);

export default swaggerSpec;