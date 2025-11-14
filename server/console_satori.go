// Copyright 2025 The Nakama Authors
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

package server

import (
	"context"

	"github.com/heroiclabs/nakama-common/runtime"
	"github.com/heroiclabs/nakama/v3/console"
	"github.com/heroiclabs/nakama/v3/internal/satori"
	"go.uber.org/zap"
	"google.golang.org/grpc/codes"
	"google.golang.org/grpc/status"
)

func (s *ConsoleServer) SatoriListTemplates(ctx context.Context, in *console.Template_ListRequest) (*console.Template_ListResponse, error) {
	if s.satori == nil {
		return nil, status.Error(codes.FailedPrecondition, "Satori server key not configured.")
	}

	res, err := s.satori.ConsoleMessageTemplatesList(ctx, in)
	if err != nil {
		s.logger.Error("Failed to list message templates from satori", zap.Error(err))
		return nil, err
	}

	return res, nil
}

func convertTemplateOverride(templateOverride *console.SendDirectMessageRequest_TemplateOverride, seen map[*console.SendDirectMessageRequest_TemplateOverride]struct{}) *runtime.SatoriMessageTemplateOverride {
	if templateOverride == nil {
		return nil
	}
	if _, seenBefore := seen[templateOverride]; seenBefore {
		// Prevent circular references.
		return nil
	}
	seen[templateOverride] = struct{}{}
	override := &runtime.SatoriMessageTemplateOverride{
		Title:        templateOverride.Title,
		Value:        templateOverride.Value,
		ImageURL:     templateOverride.ImageUrl,
		JsonMetadata: templateOverride.JsonMetadata,
		//Variants:     nil,
	}
	if templateOverride.Variants != nil {
		override.Variants = make(map[string]*runtime.SatoriMessageTemplateOverride, len(templateOverride.Variants))
		for key, variant := range templateOverride.Variants {
			override.Variants[key] = convertTemplateOverride(variant, seen)
		}
	}
	return override
}

func (s *ConsoleServer) SatoriSendDirectMessage(ctx context.Context, in *console.SendDirectMessageRequest) (*console.SendDirectMessageResponse, error) {
	if s.satori == nil {
		return nil, status.Error(codes.FailedPrecondition, "Satori server key not configured.")
	}

	var integrations []runtime.SatoriMessageIntegration
	if in.Integrations != nil {
		integrations = make([]runtime.SatoriMessageIntegration, 0, len(in.Integrations))
		for _, integration := range in.Integrations {
			integrations = append(integrations, satori.ConvertIntegrationToRuntime(integration))
		}
	}
	var channels map[runtime.SatoriMessageIntegration]*runtime.SatoriMessageIntegrationChannels
	if in.Channels != nil {
		channels = make(map[runtime.SatoriMessageIntegration]*runtime.SatoriMessageIntegrationChannels, len(in.Channels))
		for key, ch := range in.Channels {
			var channel *runtime.SatoriMessageIntegrationChannels
			if ch != nil {
				channel = &runtime.SatoriMessageIntegrationChannels{}
				if ch.Channels != nil {
					channel.Channels = make([]runtime.SatoriMessageIntegrationChannel, 0, len(ch.Channels))
					for _, ch := range ch.Channels {
						channel.Channels = append(channel.Channels, satori.ConvertChannelToRuntime(ch))
					}
				}
			}
			channels[satori.ConvertIntegrationToRuntime(console.MessageIntegrationType(key))] = channel
		}
	}
	var templateOverride *runtime.SatoriMessageTemplateOverride
	if in.TemplateOverride != nil {
		templateOverride = convertTemplateOverride(in.TemplateOverride, make(map[*console.SendDirectMessageRequest_TemplateOverride]struct{}, 1))
	}

	res, err := s.satori.ConsoleDirectMessageSend(ctx, in.TemplateId, in.IdentityIds, integrations, in.Persist, channels, templateOverride)
	if err != nil {
		s.logger.Error("Failed to send satori direct message", zap.Error(err))
		return nil, err
	}

	response := &console.SendDirectMessageResponse{}
	if res.DeliveryResults != nil {
		response.DeliveryResults = make([]*console.SendDirectMessageResponse_DeliveryResult, 0, len(res.DeliveryResults))
		for _, dr := range res.DeliveryResults {
			deliveryResult := &console.SendDirectMessageResponse_DeliveryResult{
				RecipientId: dr.RecipientID,
				//IntegrationResults: nil,
			}
			if dr.IntegrationResults != nil {
				deliveryResult.IntegrationResults = make([]*console.SendDirectMessageResponse_DeliveryResult_IntegrationResult, 0, len(dr.IntegrationResults))
				for _, ir := range dr.IntegrationResults {
					integrationResult := &console.SendDirectMessageResponse_DeliveryResult_IntegrationResult{
						//IntegrationType: 0,
						Success:      ir.Success,
						ErrorMessage: ir.ErrorMessage,
						//ChannelType:     0,
					}
					switch ir.IntegrationType {
					case runtime.SatoriMessageIntegrationUnknown:
						integrationResult.IntegrationType = console.MessageIntegrationType_UNKNOWN_MESSAGE_TYPE
					case runtime.SatoriMessageIntegrationFCM:
						integrationResult.IntegrationType = console.MessageIntegrationType_FCM
					case runtime.SatoriMessageIntegrationAPNS:
						integrationResult.IntegrationType = console.MessageIntegrationType_APNS
					case runtime.SatoriMessageIntegrationFacebookNotification:
						integrationResult.IntegrationType = console.MessageIntegrationType_FACEBOOK_NOTIFICATION
					case runtime.SatoriMessageIntegrationOneSignalNotification:
						integrationResult.IntegrationType = console.MessageIntegrationType_ONESIGNAL_NOTIFICATION
					case runtime.SatoriMessageIntegrationWebhookNotification:
						integrationResult.IntegrationType = console.MessageIntegrationType_WEBHOOK_NOTIFICATION
					}
					switch ir.ChannelType {
					case runtime.SatoriMessageIntegrationChannelDefault:
						integrationResult.ChannelType = console.MessageChannelType_DEFAULT
					case runtime.SatoriMessageIntegrationChannelPush:
						integrationResult.ChannelType = console.MessageChannelType_PUSH
					case runtime.SatoriMessageIntegrationChannelEmail:
						integrationResult.ChannelType = console.MessageChannelType_EMAIL
					}

					deliveryResult.IntegrationResults = append(deliveryResult.IntegrationResults, integrationResult)
				}
			}
		}
	}

	return response, nil
}
