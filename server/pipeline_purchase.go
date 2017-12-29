// Copyright 2017 The Nakama Authors
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
	"errors"
	"nakama/pkg/iap"

	"strings"

	"go.uber.org/zap"
)

func (p *pipeline) purchaseValidate(logger *zap.Logger, session session, envelope *Envelope) {
	purchase := envelope.GetPurchase()

	var validationResponse *iap.PurchaseVerifyResponse

	switch purchase.Id.(type) {
	case *TPurchaseValidation_ApplePurchase_:
		ap, err := p.convertApplePurchase(purchase.GetApplePurchase())
		if err != nil {
			logger.Warn("Could not process purchases", zap.Error(err))
			session.Send(ErrorMessageBadInput(envelope.CollationId, err.Error()), true)
			return
		}
		validationResponse = p.purchaseService.ValidateApplePurchase(session.UserID(), ap)
	case *TPurchaseValidation_GooglePurchase_:
		gp, err := p.convertGooglePurchase(purchase.GetGooglePurchase())
		if err != nil {
			logger.Warn("Could not process purchases", zap.Error(err))
			session.Send(ErrorMessageBadInput(envelope.CollationId, err.Error()), true)
			return
		}

		switch gp.ProductType {
		case "product":
			validationResponse = p.purchaseService.ValidateGooglePurchaseProduct(session.UserID(), gp)
		case "subscription":
			validationResponse = p.purchaseService.ValidateGooglePurchaseSubscription(session.UserID(), gp)
		}
	}

	response := &Envelope_PurchaseRecord{PurchaseRecord: &TPurchaseRecord{
		Success:                   validationResponse.Success,
		PurchaseProviderReachable: validationResponse.PurchaseProviderReachable,
		SeenBefore:                validationResponse.SeenBefore,
		Message:                   validationResponse.Message.Error(),
		Data:                      validationResponse.Data,
	}}

	session.Send(&Envelope{CollationId: envelope.CollationId, Payload: response}, true)
}

func (p *pipeline) convertApplePurchase(purchase *TPurchaseValidation_ApplePurchase) (*iap.ApplePurchase, error) {
	if p.purchaseService.AppleClient == nil {
		return nil, errors.New("Apple in-app purchase environment is not setup.")
	}

	if purchase.ReceiptData == "" {
		return nil, errors.New("Missing receipt data.")
	}

	if purchase.ProductId == "" {
		return nil, errors.New("Missing product ID.")
	}

	return &iap.ApplePurchase{
		ProductId:   purchase.ProductId,
		ReceiptData: purchase.ReceiptData,
	}, nil
}

func (p *pipeline) convertGooglePurchase(purchase *TPurchaseValidation_GooglePurchase) (*iap.GooglePurchase, error) {
	if p.purchaseService.GoogleClient == nil {
		return nil, errors.New("Google in-app purchase environment is not setup.")
	}

	if !(purchase.ProductType == "product" || purchase.ProductType == "subscription") {
		return nil, errors.New("Product type is required and must be one of: product, subscription")
	}

	if purchase.ProductId == "" {
		return nil, errors.New("Missing product ID.")
	}

	if purchase.PurchaseToken == "" {
		return nil, errors.New("Missing purchase token.")
	}

	return &iap.GooglePurchase{
		ProductType:   strings.ToLower(purchase.ProductType),
		ProductId:     purchase.ProductId,
		PurchaseToken: purchase.PurchaseToken,
	}, nil
}
